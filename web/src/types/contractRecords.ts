export interface ContractEvidence {id:string;url:string;purpose?:'progress'|'payment';source?:string;kind?:'image'|'video';mime?:string;}
export interface ContractPayment {id:string;amount_paise:number;method:'gateway'|'neft'|'rtgs';status:string;note:string;created_at:number;confirmed_at?:number|null;reference?:string|null;payment_id?:string|null;report_id?:string|null;source?:string;amount_refunded?:number;milestone_id?:string|null;evidence?:ContractEvidence[];actions:{can_approve:boolean;can_pay:boolean;can_report:boolean;can_check:boolean};}
export interface ContractProgress {id:string;percent:number;note:string;status:string;source:string;created_at:number;reviewed_at?:number;review_note?:string;evidence:ContractEvidence[];public_share_consent?:boolean;milestone_id?:string|null;actions:{can_review:boolean};}
export interface ContractMilestone {id:string;title:string;status:string;due_at?:number;submitted_at?:number;reviewed_at?:number;}
export interface ContractRecords {
 project:{id:string;title:string;status:string;customer_id:string;contractor_id:string;agreed_deal_paise:number;starts_at:number;ends_at:number};
 version:number;financials:{currency:'INR';agreed_deal_paise:number;confirmed_paid_paise:number;pending_reserved_paise:number;balance_paise:number;available_to_request_paise:number;gateway_collected_paise:number;contractor_received_paise:number;source?:string};
 payments:ContractPayment[];progress:ContractProgress[];milestones:ContractMilestone[];
 team?:{worker_id:string;name:string;role:string;worker_type?:string;status:string;accepted_at?:number}[];team_summary?:{accepted:number;supervisors?:number};
 payment_methods:Record<'gateway'|'neft'|'rtgs',{available:boolean;reason:string;source?:string;contractor_payout_connected?:boolean}>;
 public_progress:{enabled:boolean;source:string;url:string};
 actions:{can_request:boolean;can_approve:boolean;can_pay:boolean;can_report:boolean;can_progress:boolean;can_read_report:boolean;can_manage_public_progress:boolean};report_url:string;
}
export interface ContractBankInstructions {account_holder:string;account_number:string;ifsc:string;bank_name:string;last4:string;source:string;guidance:string;}
export interface ContractCheckoutOrder {payment_id:string;order_id:string;amount_paise:number;currency:string;key_id:string;status:string;source:string;contractor_payout_connected:boolean;}
