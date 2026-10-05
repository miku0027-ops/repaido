// Opt-in local QA only; Vite removes the caller from production builds.
import axe from 'axe-core';

export function startUiAudit() {
  // Development-only reflow/motion checks; never change a saved user preference.
  const params = new URLSearchParams(location.search);
  if (params.get('uiText') === '200') {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.classList.add('large-text');
  }
  if (params.get('uiMotion') === 'reduce') document.documentElement.classList.add('reduce-motion');
  const panel = document.createElement('aside');
  panel.id = 'ui-audit-tools';
  panel.setAttribute('aria-label', 'Development accessibility checks');
  panel.style.cssText = 'position:fixed;top:8px;right:8px;z-index:10000;background:white;color:#0b132b;border:1px solid #68768a;padding:8px;border-radius:12px';
  const trigger = document.createElement('button');
  trigger.textContent = 'Run accessibility audit';
  const output = document.createElement('pre');
  output.dataset.uiAuditResult = '';
  output.hidden = true;
  output.style.whiteSpace = 'pre-wrap';
  trigger.onclick = async () => {
    trigger.disabled = true;
    output.textContent = 'Running';
    try {
      const result = await axe.run({exclude: [['#ui-audit-tools']]}, {
        runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']},
        rules: {'color-contrast-enhanced': {enabled:true}},
      });
      output.textContent = JSON.stringify({
        url:location.pathname,
        violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),
        incomplete:result.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),
        passes:result.passes.length,
      });
    } catch(error) { output.textContent = JSON.stringify({error:String(error)}); }
    finally { trigger.disabled = false; }
  };
  panel.append(trigger, output);
  document.body.append(panel);
  document.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyA' && !trigger.disabled) {
      event.preventDefault();
      trigger.click();
    }
  });
}
