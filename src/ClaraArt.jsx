import React from "react";
import welcome from "./assets/clara-poses/clara-01-boas-vindas.webp";
import approval from "./assets/clara-poses/clara-02-aprovacao.webp";
import right from "./assets/clara-poses/clara-03-apontando-direita.webp";
import left from "./assets/clara-poses/clara-04-apontando-esquerda.webp";
import down from "./assets/clara-poses/clara-05-apontando-baixo.webp";
import idea from "./assets/clara-poses/clara-06-ideia.webp";
import thinking from "./assets/clara-poses/clara-07-pensando.webp";
import celebrating from "./assets/clara-poses/clara-08-celebrando.webp";
import heart from "./assets/clara-poses/clara-09-coracao.webp";
import presenting from "./assets/clara-poses/clara-10-apresentando.webp";
import agenda from "./assets/clara-poses/clara-11-agenda.webp";
import phone from "./assets/clara-poses/clara-12-celular.webp";
import notes from "./assets/clara-poses/clara-13-anotando.webp";
import reminder from "./assets/clara-poses/clara-14-lembrete.webp";
import confident from "./assets/clara-poses/clara-15-confianca.webp";

const poses = { welcome, approval, right, left, down, idea, thinking, celebrating, heart, presenting, agenda, phone, notes, reminder, confident };

// Decorative artwork: surrounding text and controls provide the meaning.
export default function ClaraArt({ pose = "welcome", ...props }) {
  return <img src={poses[pose] || poses.welcome} alt="" width="768" height="768" decoding="async" {...props} />;
}
