import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Assembly } from '../model/pipeline';

export function Stage3D({ assembly, bed }: { assembly: Assembly; bed: [number, number] }) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; bed: THREE.Group } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 3000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -220, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(-80, -120, 200);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dir2.position.set(120, 80, 60);
    scene.add(dir2);
    const group = new THREE.Group();
    scene.add(group);
    const bedGroup = new THREE.Group();
    scene.add(bedGroup);
    ctx.current = { renderer, scene, camera, controls, group, bed: bedGroup };
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.bed.clear();
    const grid = new THREE.GridHelper(Math.max(bed[0], bed[1]), Math.round(Math.max(bed[0], bed[1]) / 10), 0x888888, 0xbbbbbb);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    c.bed.add(grid);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed[0], bed[1])), new THREE.LineBasicMaterial({ color: 0x888888 }));
    c.bed.add(edges);
  }, [bed]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.group.clear();
    const b = assembly.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    for (const obj of assembly.objects)
      for (const part of obj.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1));
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(part.color), roughness: 0.6, metalness: 0.05, flatShading: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(obj.offset[0] - cx, obj.offset[1] - cy, 0);
        c.group.add(mesh);
      }
    const size = Math.max(40, b.maxX - b.minX, b.maxY - b.minY);
    c.controls.target.set(0, 0, 0);
    const d = size * 1.6;
    if (c.camera.position.length() < 5 || Math.abs(c.camera.position.length() - d) > d * 2) c.camera.position.set(0, -d * 0.9, d * 0.8);
  }, [assembly]);

  return <div ref={host} className="stage__canvas" />;
}
