'use client';

import { useEffect, useState } from 'react';

export default function PreguntasBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch('/api/ml/questions/pending-count', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (active) setCount(j.count ?? 0);
      } catch {
        // si falla, simplemente no mostramos el badge esta vez
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!count) return null;

  return (
    <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
      {count}
    </span>
  );
}
