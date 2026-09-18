'react';
import React, { useState } from 'react';

interface BookProps {
  journalTitle: string;
  pages: { pageNumber: number; content: string }[];
}

export const Book: React.FC<BookProps> = ({ journalTitle, pages }) => {
  const [currentPage, setCurrentPage] = useState(0);

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-[#FFFDF8] rounded-xl shadow-xl border border-[#E8E2E4] max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-[#242424]">{journalTitle}</h2>
      
      <div className="flex w-full min-h-[500px] border border-[#E8E2E4] bg-white rounded shadow-inner overflow-hidden">
        <div className="w-1/2 p-8 border-r border-[#E8E2E4] flex flex-col justify-between">
          <span className="text-xs text-[#6B6B6B]">Page {currentPage * 2 + 1}</span>
          <div className="my-auto text-center font-serif text-[#242424]">
            {pages[currentPage * 2]?.content || "Blank page"}
          </div>
          <span className="text-xs text-right text-[#6B6B6B]">Left Spread</span>
        </div>
        <div className="w-1/2 p-8 flex flex-col justify-between">
          <span className="text-xs text-[#6B6B6B]">Page {currentPage * 2 + 2}</span>
          <div className="my-auto text-center font-serif text-[#242424]">
            {pages[currentPage * 2 + 1]?.content || "Blank page"}
          </div>
          <span className="text-xs text-right text-[#6B6B6B]">Right Spread</span>
        </div>
      </div>

      <div className="flex gap-4 mt-6">
        <button
          onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
          disabled={currentPage === 0}
          className="px-4 py-2 border rounded disabled:opacity-30"
        >
          Previous
        </button>
        <button
          onClick={() => setCurrentPage(p => p + 1)}
          disabled={(currentPage + 1) * 2 >= pages.length}
          className="px-4 py-2 border rounded disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
};
