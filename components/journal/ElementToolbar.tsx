'use client';

import React from 'react';

interface ElementToolbarProps {
  onAddElement: (type: 'text' | 'image' | 'flower' | 'tape') => void;
}

export const ElementToolbar: React.FC<ElementToolbarProps> = ({ onAddElement }) => {
  return (
    <aside className="bg-white border border-[#E8E2E4] rounded-xl p-4 shadow-sm flex flex-col gap-3 w-48">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">Add Elements</h3>
      
      <button
        onClick={() => onAddElement('text')}
        className="flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-[#FFF7F8] transition"
      >
        <span>📝</span> Text Note
      </button>

      <button
        onClick={() => onAddElement('image')}
        className="flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-[#FFF7F8] transition"
      >
        <span>📷</span> Polaroid / Photo
      </button>

      <button
        onClick={() => onAddElement('flower')}
        className="flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-[#FFF7F8] transition"
      >
        <span>🌸</span> Flower / Sticker
      </button>

      <button
        onClick={() => onAddElement('tape')}
        className="flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-[#FFF7F8] transition"
      >
        <span>📌</span> Washi Tape
      </button>
    </aside>
  );
};