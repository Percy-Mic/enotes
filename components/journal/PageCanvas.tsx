'use client';

import React, { useState } from 'react';
import { PageElement } from '@/types/journal';

interface PageCanvasProps {
  pageId: string;
  initialElements: PageElement[];
  background?: string;
}

export const PageCanvas: React.FC<PageCanvasProps> = ({
  pageId,
  initialElements,
  background = '#FFFDF8',
}) => {
  const [elements, setElements] = useState<PageElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  return (
    <div
      className="relative w-[800px] h-[1100px] mx-auto shadow-2xl rounded border border-[#E8E2E4] overflow-hidden"
      style={{ backgroundColor: background }}
      onClick={() => setSelectedId(null)}
    >
      {elements.map((el) => {
        const isSelected = selectedId === el.id;
        return (
          <div
            key={el.id}
            onClick={(e) => {
              e.stopPropagation();
              handleSelect(el.id);
            }}
            className={`absolute cursor-move transition-shadow ${
              isSelected ? 'ring-2 ring-[#1E90FF] ring-offset-1' : ''
            }`}
            style={{
              left: `${el.transform.x}px`,
              top: `${el.transform.y}px`,
              width: `${el.transform.width}px`,
              height: `${el.transform.height}px`,
              transform: `rotate(${el.transform.rotation}deg)`,
              zIndex: el.zIndex,
              opacity: el.opacity,
            }}
          >
            {el.type === 'text' && (
              <div className="w-full h-full p-3 font-serif text-[#242424] bg-transparent outline-none resize-none">
                {el.content.text || "Write freely..."}
              </div>
            )}
            {el.type === 'image' && (
              <div className="w-full h-full bg-white p-2 pb-8 shadow-md border border-[#E8E2E4] rotate-[-1deg]">
                <img
                  src={el.content.url || "https://images.unsplash.com/photo-1517841905240-472988babdf9"}
                  alt={el.content.caption || "Memory"}
                  className="w-full h-full object-cover"
                />
                <span className="block text-center text-xs font-serif text-[#6B6B6B] mt-2">
                  {el.content.caption}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};