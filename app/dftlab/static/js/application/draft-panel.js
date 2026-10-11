import {promoteStructure} from '../learn/promote.js';

// Application orchestration only; all authority and persistence live in /api/v1.
export function draftPanel({client,projectId,status,isCurrent}){
  const panel=document.createElement('section');panel.dataset.draftPanel='';
  const heading=document.createElement('h4');heading.textContent='Borradores';panel.append(heading);
  const summary=document.createElement('p');summary.textContent='Promoción explícita: copia una estructura exportada de Aprender. No envía cálculos.';panel.append(summary);
  const list=document.createElement('div');panel.append(list);
  const form=document.createElement('form');
  const title=document.createElement('input');title.required=true;title.maxLength=200;title.setAttribute('aria-label','Título del borrador');title.placeholder='Título del borrador';
  const dataset=document.createElement('input');dataset.required=true;dataset.setAttribute('aria-label','Dataset de aprendizaje');dataset.placeholder='Identificador del dataset de origen';
  const file=document.createElement('input');file.type='file';file.accept='.json';file.required=true;file.setAttribute('aria-label','Estructura exportada de Aprender');
  const button=document.createElement('button');button.type='submit';button.textContent='Promover a borrador';
  form.append(title,dataset,file,button);panel.append(form);
  let generation=0,pending=null;
  async function refresh(){
    const mine=++generation;
    const drafts=await client.drafts(projectId);
    if(!isCurrent()||mine!==generation)return;
    list.replaceChildren();
    for(const record of drafts){
      const value=record.payload,row=document.createElement('article');row.dataset.draftId=value.draft_id;
      const name=document.createElement('p');name.textContent=value.title;row.append(name);
      const metadata=document.createElement('p');metadata.dataset.draftMetadata='';
      metadata.textContent=`Origen: ${value.origin.kind}; finalidad: ${value.purpose}; procedencia: ${value.provenance_state}; evaluación: ${value.scientific_assessment}; revisión: ${value.revision}`;row.append(metadata);
      const change=document.createElement('button');change.textContent=value.purpose==='EXPLORATORY'?'Cambiar finalidad a OPERATIONAL':'Cambiar finalidad a EXPLORATORY';row.append(change);
      const request={idempotency_key:crypto.randomUUID(),expected_revision:value.revision,changes:{purpose:value.purpose==='EXPLORATORY'?'OPERATIONAL':'EXPLORATORY'}};
      change.onclick=async()=>{
        change.disabled=true;
        try{await client.reviseDraft(value.draft_id,request);if(isCurrent()){status.textContent='Nueva revisión guardada. La evaluación sigue NOT_EVALUATED.';await refresh();}}
        catch(error){if(isCurrent())status.textContent=error.code||'No se pudo guardar la revisión. Reintentar conserva la clave.';}
        finally{change.disabled=false;}
      };
      list.append(row);
    }
  }
  form.onsubmit=async event=>{
    event.preventDefault();for(const field of [title,dataset,file,button])field.disabled=true;
    try{
      const selected=file.files?.[0];if(!selected||selected.size>512*1024)throw new Error('Estructura inválida o demasiado grande');
      const text=await selected.text();
      const signature=JSON.stringify([title.value,dataset.value,text]);
      if(!pending||pending.signature!==signature)pending={signature,key:crypto.randomUUID()};
      await promoteStructure({structure:JSON.parse(text),projectId,learningDatasetId:dataset.value,title:title.value,key:pending.key,createDraft:client.createDraft});
      pending=null;
      if(isCurrent()){status.textContent='Borrador guardado: EXPLORATORY, PARTIAL, NOT_EVALUATED. No se ha enviado ningún cálculo.';form.reset();await refresh();}
    }catch(error){if(isCurrent())status.textContent=error.code||error.message||'No se pudo promover la estructura.';}
    finally{for(const field of [title,dataset,file,button])field.disabled=false;}
  };
  return {element:panel,refresh};
}
