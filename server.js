import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET;
const databaseUrl = process.env.PORTAL_DATABASE_URL;
if (!secret || secret.length < 32 || !databaseUrl) {
  console.error('Configure SESSION_SECRET (32+ caracteres) e PORTAL_DATABASE_URL.');
  process.exit(1);
}
const pool = new Pool({connectionString:databaseUrl,ssl:process.env.PGSSL === 'true'?{rejectUnauthorized:true}:undefined});
const PgSession = connectPgSimple(session);
const PORTAL_SCHEMA = 'portal_missionario';
if (isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"]}}}));
app.use(express.json({limit:'20kb'}));
app.use(session({store:new PgSession({pool,schemaName:PORTAL_SCHEMA,tableName:'portal_sessions',createTableIfMissing:true}),secret,resave:false,saveUninitialized:false,name:'portal.sid',cookie:{httpOnly:true,sameSite:'lax',secure:isProd,maxAge:8*60*60*1000}}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
app.use('/api/login',rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}));

async function init(){
 // Cria somente o esquema exclusivo do portal; não altera tabelas existentes.
 await pool.query('CREATE SCHEMA IF NOT EXISTS portal_missionario');
 await pool.query(`CREATE TABLE IF NOT EXISTS portal_missionario.portal_users (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('admin','missionary')),
 password_hash TEXT NOT NULL, must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS portal_missionario.portal_replies (
 id BIGSERIAL PRIMARY KEY,
 message_id BIGINT NOT NULL UNIQUE,
 portal_user_id BIGINT NOT NULL REFERENCES portal_missionario.portal_users(id),
 recipient_email TEXT NOT NULL,
 reply_text TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','sent','failed','uncertain')),
 provider_id TEXT,
 error_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 sent_at TIMESTAMPTZ
 )`);
 const adminEmail=process.env.PORTAL_ADMIN_EMAIL?.trim().toLowerCase();
 const adminPassword=process.env.PORTAL_ADMIN_PASSWORD;
 const count=await pool.query("SELECT COUNT(*)::int AS n FROM portal_missionario.portal_users WHERE role='admin'");
 if(count.rows[0].n===0){
  if(!adminEmail || !adminPassword || adminPassword.length<12) throw Error('Primeiro acesso: configure PORTAL_ADMIN_EMAIL e PORTAL_ADMIN_PASSWORD (12+ caracteres).');
  const hash=await bcrypt.hash(adminPassword,12);
  await pool.query('INSERT INTO portal_missionario.portal_users(name,email,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5)', ['Administrador',adminEmail,'admin',hash,true]);
  console.log('Conta administrativa inicial criada. A troca de senha será obrigatória.');
 }
}
const requireAuth=(req,res,next)=>{if(!req.session.userId)return res.status(401).json({error:'Faça login.'});next();};
const requireAdmin=(req,res,next)=>{if(req.session.role!=='admin')return res.status(403).json({error:'Acesso restrito.'});next();};
const requireChanged=(req,res,next)=>{if(req.session.mustChange)return res.status(403).json({error:'Troque sua senha antes de continuar.'});next();};
const validEmail=e=>typeof e==='string' && e.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword=p=>typeof p==='string' && p.length>=12 && p.length<=128;
const safeUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,mustChange:u.must_change_password});

app.get('/api/me',async(req,res)=>{
 if(!req.session.userId)return res.json({user:null});
 const r=await pool.query('SELECT id,name,email,role,must_change_password,active FROM portal_missionario.portal_users WHERE id=$1',[req.session.userId]);
 if(!r.rowCount || !r.rows[0].active){req.session.destroy(()=>{});return res.json({user:null});}
 res.json({user:safeUser(r.rows[0])});
});
app.get('/api/csrf',(req,res)=>{if(!req.session.csrf)req.session.csrf=crypto.randomBytes(32).toString('hex');res.json({token:req.session.csrf});});
app.use('/api',(req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
 if(!req.session.csrf || req.get('x-csrf-token')!==req.session.csrf)return res.status(403).json({error:'Sessão de segurança inválida. Atualize a página.'});
}next();});
app.post('/api/login',async(req,res,next)=>{try{
 const email=String(req.body.email||'').trim().toLowerCase();
 const password=req.body.password;
 if(!validEmail(email)||typeof password!=='string')return res.status(401).json({error:'E-mail ou senha incorretos.'});
 const r=await pool.query('SELECT * FROM portal_missionario.portal_users WHERE email=$1 AND active=true',[email]);
 const hash=r.rows[0]?.password_hash || '$2a$12$ZzJHmyf8X9Yv5dOozq0A2.8sG7bybHVysq5N1pbyi.2hrHytvBHIu';
 const ok=await bcrypt.compare(password,hash);
 if(!r.rowCount||!ok)return res.status(401).json({error:'E-mail ou senha incorretos.'});
 req.session.regenerate(err=>{if(err)return next(err);
  const u=r.rows[0];req.session.userId=u.id;req.session.role=u.role;req.session.mustChange=u.must_change_password;
  req.session.csrf=crypto.randomBytes(32).toString('hex');res.json({user:safeUser(u),token:req.session.csrf});
 });
}catch(e){next(e);}});
app.post('/api/logout',(req,res)=>{req.session.destroy(()=>res.json({ok:true}));});
app.post('/api/change-password',requireAuth,async(req,res,next)=>{try{
 const {currentPassword,newPassword}=req.body;
 if(!validPassword(newPassword))return res.status(400).json({error:'A nova senha deve ter entre 12 e 128 caracteres.'});
 const r=await pool.query('SELECT password_hash FROM portal_missionario.portal_users WHERE id=$1',[req.session.userId]);
 if(!r.rowCount||!await bcrypt.compare(String(currentPassword||''),r.rows[0].password_hash))return res.status(400).json({error:'Senha atual incorreta.'});
 if(currentPassword===newPassword)return res.status(400).json({error:'Escolha uma senha diferente.'});
 await pool.query('UPDATE portal_missionario.portal_users SET password_hash=$1,must_change_password=false WHERE id=$2',[await bcrypt.hash(newPassword,12),req.session.userId]);
 req.session.mustChange=false;res.json({ok:true});
}catch(e){next(e);}});
app.get('/api/missionaries',requireAuth,requireChanged,requireAdmin,async(req,res,next)=>{try{
 const r=await pool.query("SELECT id,name,email,active,must_change_password,created_at FROM portal_missionario.portal_users WHERE role='missionary' ORDER BY name");res.json({missionaries:r.rows});
}catch(e){next(e);}});
app.post('/api/missionaries',requireAuth,requireChanged,requireAdmin,async(req,res,next)=>{try{
 const name=String(req.body.name||'').trim();const email=String(req.body.email||'').trim().toLowerCase();const password=req.body.password;
 if(name.length<3||name.length>120||!validEmail(email)||!validPassword(password))return res.status(400).json({error:'Informe nome (3 a 120 caracteres), e-mail válido e senha provisória com 12 a 128 caracteres.'});
 const hash=await bcrypt.hash(password,12);
 const r=await pool.query("INSERT INTO portal_missionario.portal_users(name,email,role,password_hash) VALUES($1,$2,'missionary',$3) RETURNING id,name,email,active,must_change_password",[name,email,hash]);
 res.status(201).json({missionary:r.rows[0]});
}catch(e){if(e.code==='23505')return res.status(409).json({error:'E-mail já cadastrado.'});next(e);}});
app.post('/api/missionaries/:id/reset',requireAuth,requireChanged,requireAdmin,async(req,res,next)=>{try{
 const password=req.body.password;
 if(!validPassword(password))return res.status(400).json({error:'A senha provisória precisa de 12 a 128 caracteres.'});
 const r=await pool.query("UPDATE portal_missionario.portal_users SET password_hash=$1,must_change_password=true WHERE id=$2 AND role='missionary' RETURNING id",[await bcrypt.hash(password,12),req.params.id]);
 if(!r.rowCount)return res.status(404).json({error:'Missionário não encontrado.'});res.json({ok:true});
}catch(e){next(e);}});
app.patch('/api/missionaries/:id/active',requireAuth,requireChanged,requireAdmin,async(req,res,next)=>{try{
 if(typeof req.body.active!=='boolean')return res.status(400).json({error:'Valor inválido.'});
 const r=await pool.query("UPDATE portal_missionario.portal_users SET active=$1 WHERE id=$2 AND role='missionary' RETURNING id",[req.body.active,req.params.id]);
 if(!r.rowCount)return res.status(404).json({error:'Missionário não encontrado.'});res.json({ok:true});
}catch(e){next(e);}});
// Acesso somente de leitura às mensagens efetivamente enviadas pelo sistema principal.
// A identidade é vinculada por e-mail único no cadastro principal. Se não houver
// correspondência exata e inequívoca, nenhuma mensagem é exibida.
app.get('/api/portal',requireAuth,requireChanged,async(req,res,next)=>{try{
 if(req.session.role!=='missionary')return res.json({messages:[],batches:[],integration:'admin'});
 const account=await pool.query("SELECT email FROM portal_missionario.portal_users WHERE id=$1 AND role='missionary' AND active=true",[req.session.userId]);
 if(account.rowCount!==1)return res.status(403).json({error:'Conta indisponível.'});
 const linked=await pool.query('SELECT id FROM public.missionarios WHERE lower(trim(email))=$1 AND ativo=true',[account.rows[0].email]);
 if(linked.rowCount!==1)return res.json({messages:[],batches:[],integration:'unlinked'});
 const missionaryId=linked.rows[0].id;
 const r=await pool.query(`SELECT id,nome_familia,mensagem,email_resposta,criado_em,enviado_em
 FROM public.mensagens_missionarios WHERE missionario_id=$1 AND status='ENVIADA' AND enviado_em IS NOT NULL
 ORDER BY enviado_em DESC, criado_em DESC, id DESC LIMIT 1000`,[missionaryId]);
 const replyRows=await pool.query('SELECT message_id,status,sent_at FROM portal_missionario.portal_replies WHERE portal_user_id=$1 AND message_id=ANY($2::bigint[])',[req.session.userId,r.rows.map(m=>m.id)]);
 const replyMap=new Map(replyRows.rows.map(row=>[String(row.message_id),row]));
 const messages=r.rows.map(m=>({id:m.id,sender:m.nome_familia,text:m.mensagem,replyEmail:m.email_resposta,createdAt:m.criado_em,releasedAt:m.enviado_em,replyStatus:replyMap.get(String(m.id))?.status||null,replySentAt:replyMap.get(String(m.id))?.sent_at||null}));
 const grouped=new Map();
 for(const m of messages){const date=new Date(m.releasedAt).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});if(!grouped.has(date))grouped.set(date,{date,count:0});grouped.get(date).count++;}
 res.json({messages,batches:[...grouped.values()],integration:'connected'});
}catch(e){next(e);}});
// Envio de uma resposta por mensagem, exclusivamente dentro do portal.
// O e-mail de destino vem do banco, nunca do navegador.
app.post('/api/messages/:id/reply',requireAuth,requireChanged,async(req,res,next)=>{try{
 if(req.session.role!=='missionary')return res.status(403).json({error:'Acesso restrito.'});
 const messageId=String(req.params.id);
 if(!/^\d+$/.test(messageId))return res.status(400).json({error:'Mensagem inválida.'});
 const replyText=typeof req.body.text==='string'?req.body.text.trim():'';
 if(replyText.length<1||replyText.length>4000)return res.status(400).json({error:'A resposta deve ter de 1 a 4000 caracteres.'});
 if(!process.env.RESEND_API_KEY)return res.status(503).json({error:'Envio por e-mail ainda não configurado no portal.'});
 const linked=await pool.query(`SELECT m.id,m.nome_familia,m.email_resposta
 FROM public.mensagens_missionarios m
 JOIN public.missionarios mission ON mission.id=m.missionario_id
 JOIN portal_missionario.portal_users u ON lower(trim(mission.email))=u.email
 WHERE m.id=$1 AND u.id=$2 AND u.role='missionary' AND u.active=true
 AND mission.ativo=true AND m.status='ENVIADA' AND m.enviado_em IS NOT NULL`,[messageId,req.session.userId]);
 if(linked.rowCount!==1)return res.status(404).json({error:'Mensagem não encontrada ou não liberada.'});
 const message=linked.rows[0];
 const recipient=String(message.email_resposta||'').trim();
 if(!validEmail(recipient))return res.status(400).json({error:'Esta mensagem não possui um e-mail válido para resposta.'});
 const reserved=await pool.query(`INSERT INTO portal_missionario.portal_replies(message_id,portal_user_id,recipient_email,reply_text,status)
 VALUES($1,$2,$3,$4,'sending') ON CONFLICT(message_id) DO NOTHING RETURNING id`,[messageId,req.session.userId,recipient,replyText]);
 if(!reserved.rowCount)return res.status(409).json({error:'Já existe uma resposta registrada ou em processamento para esta mensagem. Atualize a página.'});
 const replyId=reserved.rows[0].id;
 const sender=process.env.PORTAL_FROM_EMAIL||'Mensagens Missionárias <mensagens@mail.familycode.com.br>';
 let response;
 try{
  response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'portal-reply-'+replyId},body:JSON.stringify({from:sender,to:[recipient],subject:'Resposta à sua mensagem para o missionário',text:replyText,reply_to:process.env.PORTAL_REPLY_TO_EMAIL||undefined}),signal:AbortSignal.timeout(20000)});
 }catch(err){
  await pool.query("UPDATE portal_missionario.portal_replies SET status='uncertain',error_message='Resultado do provedor não confirmado' WHERE id=$1",[replyId]);
  return res.status(502).json({error:'Não foi possível confirmar o envio. Não tente reenviar; avise o administrador para verificar o histórico.'});
 }
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.id){
  await pool.query("UPDATE portal_missionario.portal_replies SET status='failed',error_message=$2 WHERE id=$1",[replyId,String(result.message||'Falha no provedor').slice(0,250)]);
  return res.status(502).json({error:'O serviço de e-mail não aceitou a resposta. Avise o administrador.'});
 }
 await pool.query("UPDATE portal_missionario.portal_replies SET status='sent',provider_id=$2,sent_at=now(),error_message=NULL WHERE id=$1",[replyId,result.id]);
 res.json({ok:true,status:'sent'});
}catch(e){next(e);}});
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)),'public')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Ocorreu um erro no servidor.'});});
init().then(()=>app.listen(PORT,()=>console.log(`Portal de testes iniciado na porta ${PORT}`))).catch(e=>{console.error(e);process.exit(1);});
