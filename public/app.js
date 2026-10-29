let token='', user=null;
const $=id=>document.getElementById(id);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,method='GET',body){const r=await fetch('/api'+url,{method,headers:{'Content-Type':'application/json','x-csrf-token':token},credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
async function getToken(){token=(await api('/csrf')).token;}
function authView(mode){$('auth').classList.remove('hidden');$('app').classList.add('hidden');$('loginForm').classList.toggle('hidden',mode!=='login');$('changeForm').classList.toggle('hidden',mode!=='change');$('authLogout').classList.toggle('hidden',mode==='login');$('authTitle').textContent=mode==='change'?'Defina sua nova senha':'Entrar no portal';$('authHint').textContent=mode==='change'?'Por segurança, troque a senha provisória antes de acessar o portal.':'Acesse com o e-mail e a senha cadastrados pelo administrador.';$('authError').textContent='';}
function showApp(){if(user.mustChange)return authView('change');$('auth').classList.add('hidden');$('app').classList.remove('hidden');$('welcome').textContent='Olá, '+user.name+'! 💙';$('avatar').textContent=user.name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();$('accountInfo').textContent=user.name+' · '+user.email;document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',user.role!=='admin'));selectView('inbox');}
function selectView(view){if(view==='admin'&&user.role!=='admin')return;document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==view));document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===view));if(view==='admin')loadMissionaries();if(view==='inbox'||view==='history')loadPortal();}
async function logout(){try{await api('/logout','POST');}catch(e){}user=null;await getToken();authView('login');}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const r=await api('/login','POST',{email:$('loginEmail').value,password:$('loginPassword').value});user=r.user;token=r.token;$('loginPassword').value='';showApp();}catch(err){$('authError').textContent=err.message;}});
$('changeForm').addEventListener('submit',async e=>{e.preventDefault();if($('newPassword').value!==$('confirmPassword').value){$('authError').textContent='As novas senhas não coincidem.';return;}try{await api('/change-password','POST',{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value});user.mustChange=false;$('changeForm').reset();showApp();}catch(err){$('authError').textContent=err.message;}});
$('authLogout').onclick=logout;$('logout').onclick=logout;$('changeAgain').onclick=()=>authView('change');document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>selectView(b.dataset.view));
$('createForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/missionaries','POST',{name:$('missionName').value,email:$('missionEmail').value,password:$('missionPassword').value});$('createForm').reset();$('adminFeedback').textContent='Missionário cadastrado. Compartilhe a senha provisória por um canal seguro.';await loadMissionaries();}catch(err){$('adminFeedback').textContent=err.message;}});
async function loadMissionaries(){try{const {missionaries}=await api('/missionaries');$('missionList').replaceChildren();if(!missionaries.length){$('missionList').textContent='Nenhum missionário cadastrado.';return;}for(const m of missionaries){const row=document.createElement('div');row.className='history-item admin-row';row.innerHTML=`<div><strong>${escapeHTML(m.name)}</strong><small>${escapeHTML(m.email)} · ${m.active?'Ativo':'Desativado'} · ${m.must_change_password?'Troca de senha pendente':'Senha definida'}</small></div>`;const actions=document.createElement('div');actions.className='admin-actions';const reset=document.createElement('button');reset.textContent='Redefinir senha';reset.onclick=async()=>{const password=prompt('Digite uma nova senha provisória (mínimo 12 caracteres):');if(password===null)return;try{await api('/missionaries/'+encodeURIComponent(m.id)+'/reset','POST',{password});$('adminFeedback').textContent='Senha provisória redefinida. Informe ao missionário por canal seguro.';loadMissionaries();}catch(err){$('adminFeedback').textContent=err.message;}};const active=document.createElement('button');active.textContent=m.active?'Desativar':'Ativar';active.onclick=async()=>{if(!confirm('Confirmar alteração de acesso?'))return;try{await api('/missionaries/'+encodeURIComponent(m.id)+'/active','PATCH',{active:!m.active});loadMissionaries();}catch(err){$('adminFeedback').textContent=err.message;}};actions.append(reset,active);row.append(actions);$('missionList').append(row);}}catch(err){$('adminFeedback').textContent=err.message;}}
(async()=>{try{await getToken();const r=await api('/me');user=r.user;if(user)showApp();else authView('login');}catch(err){authView('login');$('authError').textContent='Servidor indisponível ou ainda não configurado.';}})();

async function loadPortal(){
 if(!user||user.mustChange)return;
 try{
  const data=await api('/portal');
  $('messageList').replaceChildren();$('batchList').replaceChildren();
  $('totalMessages').textContent=data.messages.length;
  $('totalBatches').textContent=data.batches.length;
  $('totalReplies').textContent=data.messages.filter(m=>m.replyEmail).length;
  if(data.integration==='unlinked'){$('portalStatus').textContent='Sua conta ainda não está vinculada ao cadastro principal. Peça ao administrador para conferir se o e-mail é exatamente o mesmo nos dois sistemas e se não há cadastros duplicados.';return;}
  if(data.integration==='admin'){$('portalStatus').textContent='O administrador gerencia os acessos nesta página. Entre com uma conta de missionário para visualizar mensagens.';return;}
  $('portalStatus').textContent=data.messages.length?'Estas mensagens já foram liberadas por meio da compilação enviada.':'Ainda não há mensagens liberadas para esta conta.';
  for(const m of data.messages){
   const card=document.createElement('article');card.className='history-item';
   const head=document.createElement('strong');head.textContent=m.sender;
   const date=document.createElement('small');date.textContent='Enviada em '+new Date(m.releasedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
   const body=document.createElement('p');body.textContent=m.text;body.style.whiteSpace='pre-wrap';
   card.append(head,date,body);
   if(m.replyEmail){const reply=document.createElement('a');reply.textContent='✉ Responder por e-mail';reply.href='mailto:'+encodeURIComponent(m.replyEmail)+'?subject='+encodeURIComponent('Resposta à sua mensagem');reply.rel='noopener noreferrer';card.append(reply);}
   $('messageList').append(card);
  }
  for(const b of data.batches){const card=document.createElement('div');card.className='history-item';card.textContent=new Date(b.date+'T12:00:00').toLocaleDateString('pt-BR')+' · '+b.count+' mensagem(ns) liberada(s)';$('batchList').append(card);}
 }catch(e){$('portalStatus').textContent='Não foi possível carregar as mensagens: '+e.message;}
}
