/* KG Chart U2 — Administrator draft-only permissions editor.
 * No learner enforcement, no automatic migration, no browser storage deletion.
 * Reads U1 access tables only when this admin page is opened. Saves through
 * one SECURITY INVOKER PostgreSQL RPC after explicit administrator action.
 */
(function(root){
  'use strict';
  const core=root.KGAccessCore;
  if(!core)throw Error('KG Chart access core is required');
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,
    ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let sequence=0;

  function render(container,ctx){
    const run=++sequence;
    const learners=(ctx.users||[]).filter(u=>u.role==='operator').sort((a,b)=>a.email.localeCompare(b.email));
    const catalog={languages:ctx.languages||[],topics:ctx.topics||[],topicTranslations:ctx.topicTranslations||[],features:[]};
    const state={selected:learners[0]?.email||'', ready:false, loading:true, saving:false, dirty:false,
      error:'', notice:'', revision:0, mode:'legacy', draft:core.createDraft({}),audit:[],privateLessons:[],privateLoaded:false};
    const stale=()=>run!==sequence || !container.isConnected || container!==document.getElementById('content');
    const errorOf=(result)=>result?.error?.message||'';

    const paint=()=>{
      if(stale())return;
      const selector=`<div class="form-group"><label for="u2-user">Learner</label>
        <select id="u2-user" data-u2-user ${state.saving?'disabled':''}>
          ${learners.map(u=>`<option value="${escapeHtml(u.email)}" ${state.selected===u.email?'selected':''}>${escapeHtml(u.name||u.email)} · ${escapeHtml(u.email)}</option>`).join('')}
        </select></div>`;
      if(!learners.length){
        container.innerHTML='<div class="empty-state"><div class="icon">👥</div><p>No regular learners in the KG Chart allowlist yet. Register learners separately.</p></div>';
        return;
      }
      const heading=`<div style="margin-bottom:18px;border:1px solid var(--border);background:var(--bg-card);border-radius:14px;padding:18px">
        <h3 style="font-size:18px;margin-bottom:8px">🛡️ Individual user permissions — U2 drafts</h3>
        <p style="font-size:13px;color:var(--text-muted)">Choose allowed languages, topics and tools for a future restricted view.
          <strong>Saving a draft never restricts the learner.</strong> U3 must enforce database + app access before publication.
          Learner Levels and current progress remain independent.</p></div>`;
      if(state.loading){
        container.innerHTML=heading+selector+'<div class="spinner-wrap">Loading permission foundation…</div>';return;
      }
      if(state.error){
        container.innerHTML=heading+selector+`<div role="alert" style="background:var(--bg-card);padding:16px;border:1px solid var(--border);border-radius:12px">
          <strong>Permission drafts unavailable.</strong>
          <p style="margin-top:8px">${escapeHtml(state.error)}</p>
          <p style="margin-top:8px">U1 and U2 SQL foundations require separate administrator review, backup and approval.
            Nothing was changed in a learner account.</p></div>`;return;
      }

      const ds=state.draft, languageSet=new Set(ds.languages), topicSet=new Set(ds.topics.map(t=>core.topicKey(t.language_code,t.topic_id))),
        featureSet=new Set(ds.features);
      const langCards=catalog.languages.filter(l=>l.is_active===true).map(l=>`<label style="display:flex;gap:9px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--bg-card)">
        <input type="checkbox" data-u2-language="${escapeHtml(l.code)}" ${languageSet.has(l.code)?'checked':''} ${state.saving||state.mode!=='legacy'?'disabled':''}>
        <span>${escapeHtml(l.flag_emoji||'🌐')} ${escapeHtml(l.name_english||l.code)}</span></label>`).join('');
      const topicCards=ds.languages.map(lang=>{
        const options=catalog.topicTranslations.filter(t=>t.language_code===lang)
          .map(t=>({translation:t,topic:catalog.topics.find(k=>k.id===t.topic_id)}))
          .sort((a,b)=>(a.topic?.sort_order||0)-(b.topic?.sort_order||0));
        return `<div style="margin:10px 0 14px;padding:14px;border:1px solid var(--border);border-radius:12px">
          <strong>${escapeHtml(catalog.languages.find(l=>l.code===lang)?.name_english||lang)} topics</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:10px">
          ${options.map(({translation,topic})=>`<label style="display:flex;align-items:center;gap:8px;min-width:0">
            <input type="checkbox" data-u2-topic="${escapeHtml(core.topicKey(lang,translation.topic_id))}"
              ${topicSet.has(core.topicKey(lang,translation.topic_id))?'checked':''} ${state.saving||state.mode!=='legacy'?'disabled':''}>
            <span>${escapeHtml(topic?.icon||'📂')} ${escapeHtml(translation.title_native||translation.topic_id)}
              ${topic?.is_hidden?'<small>(globally hidden)</small>':''}</span></label>`).join('')||'<em>No translated topics available</em>'}
          </div></div>`;
      }).join('');
      const featureGroups=['navigation','quiz','offline'].map(family=>{
        const subset=catalog.features.filter(f=>f.family===family && f.is_active);
        return `<div style="padding:12px;border:1px solid var(--border);border-radius:12px">
          <strong style="text-transform:capitalize">${escapeHtml(family)}</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:10px">
          ${subset.map(f=>`<label style="display:flex;align-items:center;gap:7px">
            <input type="checkbox" data-u2-feature="${escapeHtml(f.feature_key)}"
              ${featureSet.has(f.feature_key)?'checked':''} ${state.saving||state.mode!=='legacy'?'disabled':''}>
            <span>${escapeHtml(f.label)}</span></label>`).join('')||'<em>None</em>'}</div></div>`;
      }).join('');
      const preview=core.previewDraft(ds,catalog,state.selected,state.privateLessons);
      const count=preview.topics.length;
      const nonempty=catalog.features.length>0;
      const status=state.mode!=='legacy'?'Restricted profile already exists — U2 editing disabled.':
        'Current learner access: LEGACY (unchanged). Draft only; proposed restrictions are NOT active.';
      container.innerHTML=heading+selector+`
        <div style="padding:13px 16px;background:var(--bg-tertiary);border-radius:10px;margin-bottom:15px">
          <strong>${escapeHtml(status)}</strong>
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Draft revision: ${state.revision||'not saved'}
            ${state.dirty?' · Unsaved edits':''}</div>
        </div>
        <h3 style="font-size:16px;margin-bottom:9px">1. Allowed languages</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-bottom:22px">${langCards}</div>
        <h3 style="font-size:16px;margin-bottom:6px">2. Topics within selected languages</h3>
        <p style="font-size:12px;color:var(--text-muted)">A topic needs a translation in its language. Deselecting a language removes its draft topic grants.</p>
        ${topicCards||'<p style="font-size:13px;color:var(--text-muted);margin:12px 0 18px">Choose a language to select its topics.</p>'}
        <h3 style="font-size:16px;margin:14px 0 10px">3. Learning tools</h3>
        <div style="display:grid;gap:10px;margin-bottom:20px">${featureGroups}</div>
        <div style="padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);margin-bottom:18px">
          <h3 style="font-size:15px;margin-bottom:9px">👁️ Proposed restricted-learner preview (NOT effective access)</h3>
          <p style="font-size:13px">${preview.languages.length} visible language(s),
            ${count} visible translated topic(s), ${preview.features.length} feature(s).</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:8px">
            ${preview.languages.map(l=>escapeHtml(l.name_english||l.code)).join(', ')||'No languages selected'}.
            ${!state.privateLoaded?' Private lesson filtering could not be verified.':''}
            Global locks, permissions, and server RLS will be enforced separately in U3.</p>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:9px;align-items:center">
          <button type="button" class="btn btn-accent" data-u2-save
            ${!nonempty||!state.dirty||state.saving||state.mode!=='legacy'?'disabled':''}>
            ${state.saving?'Saving…':'Save permission draft (no activation)'}</button>
          <button type="button" class="btn" data-u2-reset
            ${state.saving||state.mode!=='legacy'?'disabled':''}>Discard local edits</button>
          <span role="status" style="font-size:12px;color:var(--text-muted)">${escapeHtml(state.notice)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:16px">
          U2 cannot publish or switch any profile to restricted. Existing accounts, quiz data and offline packs are untouched.
          Public media and previous offline downloads are not made private by this draft.</div>`;
    };

    async function loadUser(){
      if(stale()||!state.ready||!state.selected)return;
      state.loading=true;state.error='';state.notice='';state.dirty=false;paint();
      const email=state.selected;
      const [pr,lg,tp,ft,au]=await Promise.all([
        ctx.sb.from('kg_chart_access_profiles').select('mode,revision').eq('email',email).maybeSingle(),
        ctx.sb.from('kg_chart_access_languages').select('language_code').eq('email',email),
        ctx.sb.from('kg_chart_access_topics').select('language_code,topic_id').eq('email',email),
        ctx.sb.from('kg_chart_access_features').select('feature_key').eq('email',email),
        ctx.sb.from('kg_chart_access_draft_audit').select('revision,created_at').eq('email',email).order('revision',{ascending:false}).limit(5)
      ]);
      if(stale()||email!==state.selected)return;
      const error=[pr,lg,tp,ft,au].map(errorOf).find(Boolean);
      if(error){state.error=error;state.loading=false;paint();return;}
      state.mode=pr.data?.mode||'legacy';
      state.revision=Number(pr.data?.revision||0);
      state.draft=core.createDraft({
        languages:(lg.data||[]).map(r=>r.language_code),
        topics:tp.data||[],features:(ft.data||[]).map(r=>r.feature_key)
      });
      state.saved=core.createDraft(state.draft);
      state.audit=au.data||[];
      state.loading=false;
      paint();
    }
    async function initialise(){
      state.loading=true;paint();
      const [fc,priv]=await Promise.all([
        ctx.sb.from('kg_chart_access_feature_catalog')
          .select('feature_key,label,family,sort_order,is_active').eq('is_active',true).order('sort_order'),
        ctx.sb.from('kg_chart_settings').select('value').eq('key','private_lessons').maybeSingle()
      ]);
      if(stale())return;
      if(fc.error){state.loading=false;state.error=fc.error.message;paint();return;}
      if(!Array.isArray(fc.data)||!fc.data.length){
        state.loading=false;state.error='U1 feature catalogue is empty; review the foundation SQL before editing.';paint();return;
      }
      catalog.features=fc.data;
      state.privateLessons=Array.isArray(priv.data?.value)?priv.data.value:[];
      state.privateLoaded=!priv.error;
      state.ready=true;
      await loadUser();
    }
    async function save(){
      if(stale()||state.saving||!state.dirty||!state.ready||state.mode!=='legacy')return;
      const check=core.validateDraft(state.draft,catalog);
      if(check){state.notice=check;paint();return;}
      state.saving=true;state.notice='';paint();
      const expected=state.revision;
      const {data,error}=await ctx.sb.rpc('kg_chart_u2_save_access_draft',
        core.payload(state.selected,expected,state.draft));
      if(stale())return;
      state.saving=false;
      if(error){state.notice='Save rejected: '+error.message+' Reload the learner if the revision is stale.';paint();return;}
      if(data?.mode!=='legacy'||data?.applied_to_learners!==false||data?.revision!==expected+1){
        state.notice='Unexpected save response. Reload and review server data.';paint();return;
      }
      await loadUser();
      if(stale())return;
      state.notice='Draft stored (revision '+data.revision+'); no learner permissions activated.';
      paint();
    }
    const onChange=event=>{
      const el=event.target;
      if(el.hasAttribute('data-u2-user')){
        if(state.dirty&&!confirm('Discard unsaved permission draft changes?')){
          el.value=state.selected;return;
        }
        state.selected=el.value;loadUser();return;
      }
      if(state.loading||state.saving||state.mode!=='legacy')return;
      const d=state.draft;
      if(el.hasAttribute('data-u2-language')){
        const lang=el.getAttribute('data-u2-language');
        d.languages=el.checked?[...new Set([...d.languages,lang])]:d.languages.filter(x=>x!==lang);
        if(!el.checked)d.topics=d.topics.filter(t=>t.language_code!==lang);
      }else if(el.hasAttribute('data-u2-topic')){
        const topic=core.keyParts(el.getAttribute('data-u2-topic'));
        if(!topic)return;
        const key=core.topicKey(topic.language_code,topic.topic_id);
        d.topics=el.checked?[...d.topics.filter(t=>core.topicKey(t.language_code,t.topic_id)!==key),topic]:
          d.topics.filter(t=>core.topicKey(t.language_code,t.topic_id)!==key);
      }else if(el.hasAttribute('data-u2-feature')){
        const f=el.getAttribute('data-u2-feature');
        d.features=el.checked?[...new Set([...d.features,f])]:d.features.filter(x=>x!==f);
      }else return;
      state.dirty=true;state.notice='';paint();
    };
    const onClick=event=>{
      if(event.target.closest('[data-u2-save]'))save();
      if(event.target.closest('[data-u2-reset]')&&!state.saving){
        state.draft=core.createDraft(state.saved);
        state.dirty=false;state.notice='Unsaved edits discarded.';paint();
      }
    };
    if(container.__kgU2Handlers){
      container.removeEventListener('change',container.__kgU2Handlers.onChange);
      container.removeEventListener('click',container.__kgU2Handlers.onClick);
    }
    container.addEventListener('change',onChange);
    container.addEventListener('click',onClick);
    container.__kgU2Handlers={onChange,onClick};
    initialise();
  }

  root.KGAccessStudio={render};
})(window);
