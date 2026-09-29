import {FlowEditor} from '@/components/FlowEditor';
export default async function Page({params}:{params:Promise<{id:string}>}){return <FlowEditor id={(await params).id}/>;}
