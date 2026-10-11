import React from "react";
import claraLogo from "./assets/clara-logo-v2.png";
import "./brand.css";

export function BrandLogo() {
  return (
    <img className="brand-logo" src={claraLogo} alt="Clara" width="2172" height="724" />
  );
}

export function BrandMark({ size = 24 }) {
  return (
    <span
      className="clara-brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export default function Brand() {
  return <a className="brand" href="#/" aria-label="Clara — início"><BrandLogo /></a>;
}
