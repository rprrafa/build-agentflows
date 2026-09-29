const retired=()=>Response.json({error:'Configurações antigas desativadas. Conecte o ChatGPT pelo editor.'},{status:410});
export {retired as GET,retired as POST,retired as PUT};
