"use client";
import { useEffect, useRef } from "react";

type Node = { x: number; y: number; vx: number; vy: number; r: number };
type Pulse = { a: number; b: number; t: number; speed: number };

const LINK_DISTANCE = 170;
const MAX_PULSES = 6;

// Decorative network for the account screens: drifting blocks linked like a flow, with pulses
// traveling along the links. Stays static under prefers-reduced-motion and pauses while hidden.
export function ConnectionsBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0, height = 0, frame = 0, last = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let color = "22, 54, 105";

    function readColor() {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
      const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
      if (hex) color = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
    }
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas!.clientWidth; height = canvas!.clientHeight;
      canvas!.width = Math.round(width * ratio); canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(14, Math.min(48, Math.round((width * height) / 26000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12,
        r: 1.6 + Math.random() * 1.8,
      }));
      pulses = [];
    }
    function linked(a: Node, b: Node) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      return d < LINK_DISTANCE ? 1 - d / LINK_DISTANCE : 0;
    }
    function spawnPulse() {
      const a = Math.floor(Math.random() * nodes.length);
      const near = nodes.map((n, i) => i).filter((i) => i !== a && linked(nodes[a], nodes[i]) > 0.25);
      if (near.length) pulses.push({ a, b: near[Math.floor(Math.random() * near.length)], t: 0, speed: 0.0035 + Math.random() * 0.003 });
    }
    function draw(step: number) {
      context!.clearRect(0, 0, width, height);
      for (const node of nodes) {
        node.x += node.vx * step; node.y += node.vy * step;
        if (node.x < -20) node.x = width + 20; else if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20; else if (node.y > height + 20) node.y = -20;
      }
      context!.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const strength = linked(nodes[i], nodes[j]);
        if (!strength) continue;
        context!.strokeStyle = `rgba(${color}, ${(strength * 0.22).toFixed(3)})`;
        context!.beginPath(); context!.moveTo(nodes[i].x, nodes[i].y); context!.lineTo(nodes[j].x, nodes[j].y); context!.stroke();
      }
      for (const node of nodes) {
        context!.fillStyle = `rgba(${color}, 0.35)`;
        context!.beginPath(); context!.arc(node.x, node.y, node.r, 0, Math.PI * 2); context!.fill();
      }
      pulses = pulses.filter((pulse) => {
        pulse.t += pulse.speed * step;
        const a = nodes[pulse.a], b = nodes[pulse.b];
        if (pulse.t >= 1 || !linked(a, b)) return false;
        const x = a.x + (b.x - a.x) * pulse.t, y = a.y + (b.y - a.y) * pulse.t;
        const glow = context!.createRadialGradient(x, y, 0, x, y, 9);
        glow.addColorStop(0, `rgba(${color}, 0.55)`); glow.addColorStop(1, `rgba(${color}, 0)`);
        context!.fillStyle = glow;
        context!.beginPath(); context!.arc(x, y, 9, 0, Math.PI * 2); context!.fill();
        return true;
      });
      if (pulses.length < MAX_PULSES && Math.random() < 0.02 * step) spawnPulse();
    }
    function loop(time: number) {
      const step = last ? Math.min((time - last) / 16.67, 3) : 1;
      last = time;
      draw(step);
      frame = requestAnimationFrame(loop);
    }
    function start() {
      cancelAnimationFrame(frame); last = 0;
      if (reduced.matches || document.hidden) draw(0);
      else frame = requestAnimationFrame(loop);
    }
    function onResize() { resize(); start(); }
    readColor(); resize(); start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);
    reduced.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
      reduced.removeEventListener("change", start);
    };
  }, []);
  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 h-full w-full" />;
}
