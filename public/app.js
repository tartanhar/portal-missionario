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
$('authLogout').onclick=logout;$('logout').onclick=logout;$('headerLogout').onclick=logout;$('changeAgain').onclick=()=>authView('change');document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>selectView(b.dataset.view));
$('createForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/missionaries','POST',{name:$('missionName').value,email:$('missionEmail').value,password:$('missionPassword').value});$('createForm').reset();$('adminFeedback').textContent='Missionário cadastrado. Compartilhe a senha provisória por um canal seguro.';await loadMissionaries();}catch(err){$('adminFeedback').textContent=err.message;}});
async function loadMissionaries(){try{const {missionaries}=await api('/missionaries');$('missionList').replaceChildren();if(!missionaries.length){$('missionList').textContent='Nenhum missionário cadastrado.';return;}for(const m of missionaries){const row=document.createElement('div');row.className='history-item admin-row';row.innerHTML=`<div><strong>${escapeHTML(m.name)}</strong><small>${escapeHTML(m.email)} · ${m.active?'Ativo':'Desativado'} · ${m.must_change_password?'Troca de senha pendente':'Senha definida'}</small></div>`;const actions=document.createElement('div');actions.className='admin-actions';const reset=document.createElement('button');reset.textContent='Redefinir senha';reset.onclick=async()=>{const password=prompt('Digite uma nova senha provisória (mínimo 12 caracteres):');if(password===null)return;try{await api('/missionaries/'+encodeURIComponent(m.id)+'/reset','POST',{password});$('adminFeedback').textContent='Senha provisória redefinida. Informe ao missionário por canal seguro.';loadMissionaries();}catch(err){$('adminFeedback').textContent=err.message;}};const active=document.createElement('button');active.textContent=m.active?'Desativar':'Ativar';active.onclick=async()=>{if(!confirm('Confirmar alteração de acesso?'))return;try{await api('/missionaries/'+encodeURIComponent(m.id)+'/active','PATCH',{active:!m.active});loadMissionaries();}catch(err){$('adminFeedback').textContent=err.message;}};actions.append(reset,active);row.append(actions);$('missionList').append(row);}}catch(err){$('adminFeedback').textContent=err.message;}}
(async()=>{try{await getToken();const r=await api('/me');user=r.user;if(user)showApp();else authView('login');}catch(err){authView('login');$('authError').textContent='Servidor indisponível ou ainda não configurado.';}})();

let portalMessages=[];
let selectedMessageId=null;
let readMessages=new Set();
let replyDrafts=new Map();
function messageReadKey(){return 'portal_read_'+(user?.email||'');}
function loadReadState(){try{readMessages=new Set(JSON.parse(localStorage.getItem(messageReadKey())||'[]'));}catch{readMessages=new Set();}}
function markRead(id){readMessages.add(String(id));try{localStorage.setItem(messageReadKey(),JSON.stringify([...readMessages]));}catch{}}
function displayDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'Data indisponível':date.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});}
function renderMessages(){
 const list=$('messageList');list.replaceChildren();
 const filter=$('messageFilter').value;
 const visible=portalMessages.filter(m=>filter==='all'||(filter==='read'&&readMessages.has(String(m.id)))||(filter==='unread'&&!readMessages.has(String(m.id)))||(filter==='reply'&&m.replyEmail&&!m.replyStatus));
 if(!visible.length){list.innerHTML='<div class="about">Nenhuma mensagem encontrada neste filtro.</div>';}
 for(const m of visible){
  const item=document.createElement('button');item.type='button';item.className='message-card'+(String(selectedMessageId)===String(m.id)?' selected':'');
  const top=document.createElement('div');top.className='card-top';const name=document.createElement('strong');name.textContent=m.sender;const date=document.createElement('span');date.className='date';date.textContent=displayDate(m.releasedAt);top.append(name,date);
  const excerpt=document.createElement('p');excerpt.textContent=m.text;
  const tag=document.createElement('span');tag.className='tag'+(readMessages.has(String(m.id))?' muted':'');tag.textContent=readMessages.has(String(m.id))?'Lida':'Não lida';
  item.append(top,excerpt,tag);item.onclick=()=>{selectedMessageId=m.id;markRead(m.id);renderMessages();renderDetail();};list.append(item);
 }
}
function renderDetail(){
 const detail=$('messageDetail');detail.replaceChildren();const m=portalMessages.find(x=>String(x.id)===String(selectedMessageId));
 if(!m){detail.innerHTML='<p class="empty">Selecione uma mensagem para ler.</p>';return;}
 const head=document.createElement('div');head.className='detail-heading';const title=document.createElement('h2');title.textContent=m.sender;const batch=document.createElement('span');batch.className='tag';batch.textContent='Compilação '+displayDate(m.releasedAt);head.append(title,batch);
 const meta=document.createElement('p');meta.className='detail-meta';meta.textContent='Liberada em '+displayDate(m.releasedAt)+(m.replyEmail?' · E-mail disponível para resposta':'');
 const letter=document.createElement('div');letter.className='letter';letter.textContent=m.text;detail.append(head,meta,letter);
 const reply=document.createElement('div');reply.className='reply';const h3=document.createElement('h3');h3.textContent='Responder à família';reply.append(h3);
 if(!m.replyEmail){const note=document.createElement('p');note.textContent='Esta família não informou um e-mail para resposta.';reply.append(note);}
 else if(m.replyStatus==='sent'){const note=document.createElement('p');note.className='success';note.textContent='✓ Resposta enviada por e-mail.';reply.append(note);}
 else if(m.replyStatus){const note=document.createElement('p');note.textContent='Resposta registrada ('+m.replyStatus+'). Para evitar duplicações, contate o administrador.';reply.append(note);}
 else {
  const note=document.createElement('small');note.textContent='A resposta será enviada ao e-mail informado pela família, sem abrir outro aplicativo.';
  const form=document.createElement('form');form.className='reply-form';const label=document.createElement('label');label.textContent='Sua resposta';const area=document.createElement('textarea');area.required=true;area.maxLength=4000;area.rows=6;area.placeholder='Escreva sua resposta...';area.value=replyDrafts.get(String(m.id))||'';area.addEventListener('input',()=>replyDrafts.set(String(m.id),area.value));label.append(area);
  const send=document.createElement('button');send.type='submit';send.className='primary send-reply';send.textContent='✉  Enviar resposta por e-mail';const feedback=document.createElement('p');feedback.className='reply-feedback';feedback.setAttribute('role','status');
  form.append(label,send,feedback);reply.append(note,form);
  form.onsubmit=async e=>{e.preventDefault();if(!confirm('Enviar esta resposta para o e-mail informado pela família?'))return;send.disabled=true;feedback.textContent='Enviando...';try{await api('/messages/'+encodeURIComponent(m.id)+'/reply','POST',{text:area.value});replyDrafts.delete(String(m.id));feedback.textContent='Resposta enviada!';await loadPortal();}catch(err){feedback.textContent=err.message;send.disabled=false;}};
 }
 detail.append(reply);
}
$('messageFilter').addEventListener('change',renderMessages);
async function loadPortal(){
 if(!user||user.mustChange)return;
 try{
  const data=await api('/portal');
  $('batchList').replaceChildren();
  $('totalMessages').textContent=data.messages.length;
  $('totalBatches').textContent=data.batches.length;
  $('totalReplies').textContent=data.messages.filter(m=>m.replyEmail).length;
  if(data.integration==='unlinked'){$('portalStatus').textContent='Sua conta ainda não está vinculada ao cadastro principal. Peça ao administrador para conferir se o e-mail é exatamente o mesmo nos dois sistemas e se não há cadastros duplicados.';portalMessages=[];renderMessages();renderDetail();return;}
  if(data.integration==='admin'){$('portalStatus').textContent='O administrador gerencia os acessos nesta página. Entre com uma conta de missionário para visualizar mensagens.';portalMessages=[];renderMessages();renderDetail();return;}
  $('portalStatus').textContent=data.messages.length?'Estas mensagens já foram liberadas por meio da compilação enviada.':'Ainda não há mensagens liberadas para esta conta.';
  portalMessages=data.messages;loadReadState();
  if(!portalMessages.some(m=>String(m.id)===String(selectedMessageId)))selectedMessageId=portalMessages[0]?.id??null;
  if(selectedMessageId!==null)markRead(selectedMessageId);
  renderMessages();renderDetail();
  for(const b of data.batches){const card=document.createElement('div');card.className='history-item';card.textContent=new Date(b.date+'T12:00:00').toLocaleDateString('pt-BR')+' · '+b.count+' mensagem(ns) liberada(s)';$('batchList').append(card);}
 }catch(e){$('portalStatus').textContent='Não foi possível carregar as mensagens: '+e.message;}
}
