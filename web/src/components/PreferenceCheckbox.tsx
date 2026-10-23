import {useLayoutEffect,useRef,type InputHTMLAttributes} from 'react';

// Unknown is distinct from opting out. Keep the real form visible while its
// account-specific values arrive, without presenting invented privacy defaults.
export function PreferenceCheckbox({checked,disabled,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'checked'> & {checked:boolean|undefined}){
  const input=useRef<HTMLInputElement>(null);
  useLayoutEffect(()=>{if(input.current)input.current.indeterminate=checked===undefined;},[checked]);
  return <input {...props} ref={input} type="checkbox" checked={checked??false} disabled={disabled||checked===undefined} aria-busy={checked===undefined||undefined}/>;
}
