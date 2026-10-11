export function whatsappLink(phone, message) {
 let digits=String(phone||'').replace(/\D/g,'');
 if(digits.length===10||digits.length===11) digits='55'+digits;
 if(!/^55\d{10,11}$/.test(digits)) return null;
 return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
export function rescheduleMessage(item, start, studio, professional) {
 const when=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'full',timeStyle:'short'});
 return `Olá, ${item.clients?.name||'tudo bem'}! Seu atendimento de ${item.service_name} no ${studio.name} foi remarcado.\n\nAntes: ${when.format(new Date(item.starts_at))}.\nNovo horário: ${when.format(new Date(start))}.${professional?'\nProfissional: '+professional+'.':''}\n\nEsperamos você! Se precisar de algo, fale com a gente.`;
}
