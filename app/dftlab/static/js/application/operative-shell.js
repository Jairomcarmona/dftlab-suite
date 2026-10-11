import {createClient} from '../sdk/client.js';
import {draftPanel} from './draft-panel.js';

// Only emitted in the served build. Handshake never submits an operation.
export async function attach({stores}){
  const client=createClient();
  const slot=document.createElement('section');slot.className='navgrp';slot.dataset.operativeAccess='';
  const heading=document.createElement('h4');heading.textContent='Acceso local';slot.append(heading);
  const label=document.createElement('label');label.textContent='Seleccionar archivo de acceso del iniciador';
  const input=document.createElement('input');input.type='file';input.accept='.json';input.setAttribute('aria-label','Archivo de acceso local');
  label.append(input);slot.append(label);
  const status=document.createElement('p');status.textContent='Aprender, preparar y leer siguen disponibles sin sesión.';slot.append(status);
  document.querySelector('#side .sidefoot').before(slot);
  let generation=0,projectGroup=null;
  async function showProjects(){
    const mine=++generation;
    const handshake=await client.handshake();
    const projects=await client.projects();
    if(mine!==generation)return;
    projectGroup?.remove();
    projectGroup=document.createElement('nav');projectGroup.className='navgrp';projectGroup.dataset.remoteGroup='';projectGroup.setAttribute('aria-label','Proyectos y campañas');
    const title=document.createElement('h4');title.textContent='Proyectos y campañas';projectGroup.append(title);
    const selector=document.createElement('select');selector.setAttribute('aria-label','Proyecto activo');
    const empty=document.createElement('option');empty.value='';empty.textContent='Seleccionar proyecto';selector.append(empty);
    for(const project of projects){const item=document.createElement('option');item.value=project.project_id;item.textContent=project.name;selector.append(item);}
    selector.value=stores.projectId||'';
    let panel=null;
    async function selectDrafts(){
      panel?.element.remove();panel=null;
      const projectId=selector.value;stores.selectProject(projectId||null);
      if(!projectId)return;
      const created=draftPanel({client,projectId,status,isCurrent:()=>mine===generation&&selector.value===projectId&&panel===created});
      panel=created;projectGroup.append(created.element);
      try{await created.refresh();}catch(error){if(mine===generation)status.textContent=error.code||'No se pudieron leer los borradores.';}
    }
    selector.onchange=selectDrafts;
    projectGroup.append(selector);
    const logout=document.createElement('button');logout.textContent='Cerrar sesión';
    logout.onclick=async()=>{logout.disabled=true;try{await client.logout();status.textContent='Sesión cerrada.';}catch{status.textContent='No se pudo confirmar el cierre en el servicio. Reinicia el iniciador.';}finally{generation++;projectGroup?.remove();projectGroup=null;stores.selectProject(null);}};
    projectGroup.append(logout);
    const notice=document.createElement('p');notice.textContent=handshake.capabilities.some(c=>c.payload.admitted_for.includes('EXECUTION'))?'Capacidades de ejecución calificadas disponibles.':'Ejecución pendiente de calificación de motores; no se envían cálculos.';projectGroup.append(notice);
    if(client.canEdit){
      const form=document.createElement('form');const name=document.createElement('input');name.required=true;name.maxLength=200;name.placeholder='Nombre del proyecto';name.setAttribute('aria-label','Nombre del proyecto');
      const button=document.createElement('button');button.textContent='Crear proyecto';button.type='submit';form.append(name,button);projectGroup.append(form);
      let pending=null;
      form.onsubmit=async event=>{event.preventDefault();button.disabled=true;name.disabled=true;
        if(!pending||pending.name!==name.value)pending={name:name.value,key:crypto.randomUUID()};
        try{const project=await client.createProject(pending.name,pending.key);stores.selectProject(project.project_id);pending=null;await showProjects();}
        catch(error){status.textContent=error.code||'No se pudo crear el proyecto. Reintentar conserva la identidad del pedido.';}
        finally{button.disabled=false;name.disabled=false;}
      };
    }
    slot.after(projectGroup);
    status.textContent='Sesión autenticada. Proyectos y archivos pertenecen a tu identidad.';
    await selectDrafts();
  }
  input.onchange=async()=>{
    const file=input.files?.[0];input.value='';if(!file)return;
    input.disabled=true;generation++;projectGroup?.remove();projectGroup=null;stores.selectProject(null);
    try{
      if(file.size>4096)throw new Error('Oversized access file');
      const access=JSON.parse(await file.text());
      if(access.origin!==location.origin)throw new Error('Origin mismatch');
      await client.login(access.bootstrap_token);await showProjects();
    }catch(error){status.textContent=error.code||'Archivo de acceso inválido o vencido. Reinicia el iniciador para obtener uno nuevo.';}
    finally{input.disabled=false;}
  };
  try{await client.session();await showProjects();}catch(error){if(error.code!=='NOT_AUTHENTICATED')status.textContent='No se pudo verificar la sesión del servicio.';}
}
