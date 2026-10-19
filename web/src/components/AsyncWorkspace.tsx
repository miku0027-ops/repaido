import {Component,Suspense,type ReactNode} from 'react';
import {Modal} from './ui';
import './async-workspace.css';

type Props={label:string;children:ReactNode;onBack:()=>void;dialog?:boolean};

/** Keep a slow or failed workspace download recoverable instead of blanking the app. */
class WorkspaceBoundary extends Component<Props,{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  const {label,onBack,dialog}=this.props;
  if(!this.state.failed)return this.props.children;
  const message=<section className="async-workspace-state" role="alert"><h2>{label} couldn’t load</h2><p>Reload the app to try again.</p><div><button type="button" onClick={()=>window.location.reload()}>Reload app</button><button type="button" onClick={onBack}>{dialog?'Close':'Customer app'}</button></div></section>;
  return dialog?<Modal title={label} onClose={onBack}>{message}</Modal>:message;
 }
}

export function AsyncWorkspace({label,children,onBack,dialog=false}:Props){
 const status=<p className="async-workspace-state" role="status">Opening {label.toLocaleLowerCase()}…</p>;
 return <WorkspaceBoundary key={label} label={label} onBack={onBack} dialog={dialog}><Suspense fallback={dialog?<Modal title={label} onClose={onBack}>{status}</Modal>:status}>{children}</Suspense></WorkspaceBoundary>;
}
