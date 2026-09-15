'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Home,
  Lock,
  Settings,
  Share2,
  BookOpen,
} from 'lucide-react';

import { supabase } from '@/lib/supabase/client';

import ShareJournalModal from '@/components/social/ShareJournalModal';

import JournalCanvasRenderer, {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  CanvasElement,
  normalizeElements,
  safeJson,
} from '@/components/journal/JournalCanvasRenderer';

interface JournalPage {
  id: string;
  page_number: number;
  title: string;
  background: string;
  width: number;
  height: number;
  elements: CanvasElement[];
  created_at: string;
}

interface Journal {
  id: string;
  title: string;
  description?: string;
  foreword?: string;
  background_color?: string;
  owner_id?: string;
  cover_media_type?: string;
  cover_media_url?: string;
  cover_type?: string;
  cover_url?: string;
  cover_elements?: CanvasElement[] | string | null;
}

const TURN_MS = 520;

/* Book width bounds — 280 fits a 320px phone with padding */
const MIN_BOOK_WIDTH = 280;
const MAX_BOOK_WIDTH = 500;

function normalizePage(
  raw: any,
  index: number,
): JournalPage {
  return {
    id: String(raw?.id ?? `page-${index}`),
    page_number: Number(raw?.page_number ?? index + 1),
    title: raw?.title || `Page ${index + 1}`,
    background: raw?.background || '#FFFDF8',
    width: Number(raw?.width ?? CANVAS_WIDTH),
    height: Number(raw?.height ?? CANVAS_HEIGHT),
    elements: normalizeElements(raw?.elements),
    created_at: raw?.created_at || new Date().toISOString(),
  };
}

function getPageTitle(pages: JournalPage[], index: number) {
  if (index <= 0) {
    return 'Cover';
  }

  return pages[index - 1]?.title || `Page ${index}`;
}

export default function JournalBookView() {
  const params = useParams();
  const journalId = params?.journalId as string;

  const [journal, setJournal] = useState<Journal | null>(null);
  const [pages, setPages] = useState<JournalPage[]>([]);

  /* 0 = cover, 1 = first page, 2 = second page */
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [turn, setTurn] = useState<'next' | 'prev' | null>(null);
  const [progress, setProgress] = useState(0);

  const [seekOpen, setSeekOpen] = useState(false);
  const [date, setDate] = useState('');
  const [seekError, setSeekError] = useState<string | null>(null);

  const [bookWidth, setBookWidth] = useState(MAX_BOOK_WIDTH);

  /* Social: share modal + page lock gate */
  const [meId, setMeId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [lockedPageIds, setLockedPageIds] = useState<Set<string>>(new Set());
  const [unlockedPages, setUnlockedPages] = useState<Set<string>>(new Set());
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  /* Viewport tracking (drives mobile sizing incl. orientation changes) */
  const [isMobile, setIsMobile] = useState(false);

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const animationRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Who am I (owner sees locks as badges, others get the PIN gate) */
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setMeId(user?.id || null);
    })();
  }, []);

  /* Track which of the loaded pages are locked */
  useEffect(() => {
    if (!pages.length) return;

    (async () => {
      const locked = new Set<string>();

      for (const page of pages) {
        const { data } = await supabase.rpc('get_page_lock', { p_page_id: page.id });
        const row = (data as any[] | null)?.[0];
        if (row?.locked) {
          locked.add(page.id);
        }
      }

      setLockedPageIds(locked);
    })();
  }, [pages]);

  const currentPageId = index === 0 ? null : pages[index - 1]?.id || null;
  const isOwner = !!meId && meId === journal?.owner_id;
  const gateLocked =
    !!currentPageId &&
    lockedPageIds.has(currentPageId) &&
    !unlockedPages.has(currentPageId) &&
    !isOwner;

  const verifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPageId) return;

    const { data } = await supabase.rpc('verify_page_pin', {
      p_page_id: currentPageId,
      p_pin: pin.trim(),
    });

    if (data === true) {
      setUnlockedPages((prev) => new Set(prev).add(currentPageId));
      setPin('');
      setPinError(null);
    } else {
      setPinError('Wrong PIN — try again.');
      setPin('');
    }
  };

  /* ------------------------------------------------
   * LOAD
   * ------------------------------------------------ */

  useEffect(() => {
    if (!journalId) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      const [journalResult, pagesResult] = await Promise.all([
        supabase.from('journals').select('*').eq('id', journalId).single(),
        supabase
          .from('journal_pages')
          .select('*')
          .eq('journal_id', journalId)
          .order('page_number', { ascending: true }),
      ]);

      if (cancelled) {
        return;
      }

      if (journalResult.error) {
        console.error('Journal error:', journalResult.error);
      }

      if (pagesResult.error) {
        console.error('Pages error:', pagesResult.error);
      }

      if (journalResult.data) {
        setJournal(journalResult.data as Journal);
      }

      setPages((pagesResult.data || []).map(normalizePage));
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [journalId]);

  /* ------------------------------------------------
   * VIEWPORT TRACKING
   * ------------------------------------------------ */

  useEffect(() => {
    const update = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  /* ------------------------------------------------
   * RESPONSIVE BOOK SIZE — never wider than the
   * viewport, never taller than the space between
   * the header and the controls.
   * ------------------------------------------------ */

  useEffect(() => {
    function updateSize() {
      const width = window.innerWidth;
      const height = window.innerHeight;

      const desktop = width >= 1024;

      /* Vertical chrome: header (64) + info row (~28) + controls (~64) + hint (~24) + margins */
      const mobileVerticalChrome = isMobile ? 210 : 190;
      const desktopVerticalChrome = 190;

      /* Horizontal chrome: page padding + leather boards (2 × 10px) + page frame */
      const horizontalChrome = isMobile ? 46 : 90;

      const mobileWidth = Math.min(
        MAX_BOOK_WIDTH,
        width - horizontalChrome,
      );

      const mobileHeight = Math.floor(
        (height - mobileVerticalChrome) * (CANVAS_WIDTH / CANVAS_HEIGHT),
      );

      const desktopWidth = Math.min(
        MAX_BOOK_WIDTH,
        Math.floor(width * 0.42),
      );

      const desktopHeight = Math.floor(
        (height - desktopVerticalChrome) * (CANVAS_WIDTH / CANVAS_HEIGHT),
      );

      const calculated = desktop
        ? Math.min(desktopWidth, desktopHeight)
        : Math.min(mobileWidth, mobileHeight);

      setBookWidth(
        Math.max(MIN_BOOK_WIDTH, calculated),
      );
    }

    updateSize();
    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);

    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, [isMobile]);

  /* ------------------------------------------------
   * BOOK DATA
   * ------------------------------------------------ */

  const total = pages.length + 1;

  const targetIndex =
    turn === 'next'
      ? Math.min(total - 1, index + 1)
      : turn === 'prev'
        ? Math.max(0, index - 1)
        : index;

  const currentPage = index === 0 ? null : pages[index - 1] || null;
  const targetPage = targetIndex === 0 ? null : pages[targetIndex - 1] || null;

  const currentElements = useMemo(() => {
    if (index === 0) {
      return normalizeElements(journal?.cover_elements);
    }
    return currentPage?.elements || [];
  }, [index, journal?.cover_elements, currentPage]);

  const targetElements = useMemo(() => {
    if (targetIndex === 0) {
      return normalizeElements(journal?.cover_elements);
    }
    return targetPage?.elements || [];
  }, [targetIndex, journal?.cover_elements, targetPage]);

  const currentBackground =
    index === 0
      ? journal?.background_color || '#FFF7F8'
      : currentPage?.background || '#FFFDF8';

  const targetBackground =
    targetIndex === 0
      ? journal?.background_color || '#FFF7F8'
      : targetPage?.background || '#FFFDF8';

  const pageScale = bookWidth / CANVAS_WIDTH;
  const bookHeight = bookWidth * (CANVAS_HEIGHT / CANVAS_WIDTH);

  /* ------------------------------------------------
   * PAGE RENDER
   * ------------------------------------------------ */

  function PageSurface({
    background,
    elements,
    isCover = false,
    pageNumber,
  }: {
    background: string;
    elements: CanvasElement[];
    isCover?: boolean;
    pageNumber?: number;
  }) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          background,
          backgroundImage: isCover
            ? `
                repeating-linear-gradient(
                  0deg,
                  rgba(255,255,255,.025) 0,
                  rgba(255,255,255,.025) 1px,
                  transparent 1px,
                  transparent 7px
                ),
                repeating-linear-gradient(
                  90deg,
                  rgba(20,10,5,.025) 0,
                  rgba(20,10,5,.025) 1px,
                  transparent 1px,
                  transparent 13px
                )
              `
            : `
                repeating-linear-gradient(
                  0deg,
                  rgba(75,48,28,.035) 0,
                  rgba(75,48,28,.035) 1px,
                  transparent 1px,
                  transparent 31px
                ),
                repeating-linear-gradient(
                  90deg,
                  rgba(75,48,28,.012) 0,
                  rgba(75,48,28,.012) 1px,
                  transparent 1px,
                  transparent 19px
                )
              `,
        }}
      >
        <JournalCanvasRenderer
          elements={elements}
          scale={pageScale}
          className="absolute left-0 top-0"
        />

        {/* Inner paper edge */}
        <div className="pointer-events-none absolute inset-[8px] border border-[#7E6A57]/20" />

        {/* Binding shadow */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#3b2718]/25 to-transparent" />

        {/* Outer page shadow */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#3b2718]/10 to-transparent" />

        {/* Paper texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              repeating-linear-gradient(
                0deg,
                transparent 0,
                transparent 18px,
                rgba(255,255,255,.25) 18px,
                rgba(255,255,255,.25) 20px,
                transparent 20px,
                transparent 38px
              )
            `,
          }}
        />

        {!isCover && pageNumber != null && (
          <div className="pointer-events-none absolute bottom-3 right-4 font-serif text-[10px] text-[#735F4E]">
            {pageNumber}
          </div>
        )}
      </div>
    );
  }

  /* ------------------------------------------------
   * PAGE TURN
   * ------------------------------------------------ */

  function go(direction: 'next' | 'prev') {
    if (turn) {
      return;
    }

    const canMove = direction === 'next' ? index < total - 1 : index > 0;

    if (!canMove) {
      return;
    }

    setTurn(direction);
    setProgress(0);

    const started = performance.now();

    function frame(now: number) {
      const raw = Math.min(1, (now - started) / TURN_MS);

      /* Decisive physical movement — no soft fade */
      const eased = 1 - Math.pow(1 - raw, 2.4);

      setProgress(eased);

      if (raw < 1) {
        animationRef.current = requestAnimationFrame(frame);
      }
    }

    animationRef.current = requestAnimationFrame(frame);

    timeoutRef.current = setTimeout(() => {
      setIndex((value) =>
        direction === 'next'
          ? Math.min(total - 1, value + 1)
          : Math.max(0, value - 1),
      );

      setTurn(null);
      setProgress(0);
    }, TURN_MS);
  }

  /* ------------------------------------------------
   * SWIPE
   * ------------------------------------------------ */

  function onTouchStart(event: React.TouchEvent) {
    if (turn) {
      return;
    }

    const touch = event.touches[0];
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function onTouchEnd(event: React.TouchEvent) {
    if (!touchStart.current || turn) {
      return;
    }

    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;

    touchStart.current = null;

    if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) {
      return;
    }

    if (dx < 0) {
      go('next');
    } else {
      go('prev');
    }
  }

  /* ------------------------------------------------
   * DATE SEEK
   * ------------------------------------------------ */

  function seekDate(event: React.FormEvent) {
    event.preventDefault();

    const found = pages.findIndex((page) =>
      page.created_at?.startsWith(date),
    );

    if (found < 0) {
      setSeekError('No entry found for that date.');
      return;
    }

    setIndex(found + 1);
    setSeekOpen(false);
    setSeekError(null);
  }

  function openSeek() {
    setDate('');
    setSeekError(null);
    setSeekOpen(true);
  }

  /* ------------------------------------------------
   * BOOK THICKNESS
   * ------------------------------------------------ */

  const remaining = turn === 'next' ? total - index - 1 : index;

  const stackCount = Math.max(
    2,
    Math.min(18, Math.ceil(Math.max(1, remaining) / 2)),
  );

  const angle = turn === 'next' ? -180 * progress : turn === 'prev' ? 180 * progress : 0;

  const curl = Math.sin(progress * Math.PI);

  /* ------------------------------------------------
   * LOADING / MISSING
   * ------------------------------------------------ */

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#8E6847] text-[#2F2015]">
        <div className="flex items-center gap-3 font-serif text-lg">
          <BookOpen className="h-5 w-5" />
          Opening your journal…
        </div>
      </main>
    );
  }

  if (!journal) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#8E6847] px-6 font-serif text-[#2F2015]">
        <p>Journal not found.</p>

        <Link
          href="/journals"
          className="border-2 border-[#5D3D26] bg-[#EAD7BC] px-5 py-2.5 text-sm font-bold shadow-[3px_3px_0_#5D3D26]"
        >
          Back to journals
        </Link>
      </main>
    );
  }

  /* ------------------------------------------------
   * UI
   * ------------------------------------------------ */

  return (
    <main
      className="min-h-[100dvh] overflow-x-hidden text-[#2b211b]"
      style={{
        backgroundColor: '#B88C5A',
        backgroundImage: `
          repeating-linear-gradient(
            0deg,
            rgba(255,255,255,.035) 0,
            rgba(255,255,255,.035) 1px,
            transparent 1px,
            transparent 6px
          ),
          repeating-linear-gradient(
            90deg,
            rgba(70,40,15,.025) 0,
            rgba(70,40,15,.025) 2px,
            transparent 2px,
            transparent 13px
          )
        `,
      }}
    >
      {/* ===================================== */}
      {/* FIXED HEADER — compact on phones      */}
      {/* ===================================== */}

      <header className="fixed inset-x-0 top-0 z-[100] border-b-2 border-[#604328] bg-[#EAD7BC] shadow-[0_4px_0_rgba(58,36,20,.25)]">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-2 px-2.5 md:h-16 md:px-6">
          <div className="flex items-center gap-1.5">
            <Link
              href="/journals"
              aria-label="Back to journals"
              className="flex h-11 w-11 items-center justify-center border-2 border-[#76563A] bg-[#F6E9D5] shadow-[2px_2px_0_#8D6D4D] transition active:translate-x-[1px] active:translate-y-[1px]"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Link
              href="/feed"
              aria-label="Back to feed"
              className="flex h-11 w-11 items-center justify-center border-2 border-[#76563A] bg-[#F6E9D5] shadow-[2px_2px_0_#8D6D4D] transition active:translate-x-[1px] active:translate-y-[1px]"
            >
              <Home className="h-5 w-5" />
            </Link>
          </div>

          <div className="min-w-0 text-center">
            <h1 className="truncate font-serif text-base font-bold sm:text-lg md:text-2xl">
              {journal.title}
            </h1>

            <p className="text-[9px] uppercase tracking-[.22em] text-[#765D48] md:text-[10px]">
              {getPageTitle(pages, index)}
            </p>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={() => setShareOpen(true)}
              aria-label="Share journal"
              className="flex h-11 w-11 items-center justify-center border-2 border-[#76563A] bg-[#F6E9D5] shadow-[2px_2px_0_#8D6D4D] transition active:translate-x-[1px] active:translate-y-[1px]"
            >
              <Share2 className="h-5 w-5" />
            </button>

            <Link
              href={`/journals/${journalId}/edit`}
              aria-label="Edit journal"
              className="flex h-11 w-11 items-center justify-center border-2 border-[#76563A] bg-[#F6E9D5] shadow-[2px_2px_0_#8D6D4D] transition active:translate-x-[1px] active:translate-y-[1px]"
            >
              <Edit3 className="h-5 w-5" />
            </Link>

            <Link
              href={`/journals/${journalId}/settings`}
              aria-label="Journal settings"
              className="flex h-11 w-11 items-center justify-center border-2 border-[#76563A] bg-[#F6E9D5] shadow-[2px_2px_0_#8D6D4D] transition active:translate-x-[1px] active:translate-y-[1px]"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ===================================== */}
      {/* CONTENT                               */}
      {/* ===================================== */}

      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-col items-center justify-center gap-6 px-3 pb-6 pt-[72px] sm:gap-7 md:pt-24 lg:flex-row lg:gap-12">
        {/* ================================= */}
        {/* BOOK                              */}
        {/* ================================= */}

        <section
          className="flex w-full flex-col items-center"
          style={{ maxWidth: bookWidth + 50 }}
        >
          {/* Top information */}
          <div
            className="mb-2 flex w-full items-center justify-between px-1 font-serif text-[11px] text-[#F4E5D1]"
            style={{ maxWidth: bookWidth }}
          >
            <span className="inline-flex items-center gap-1">
              {currentPageId && lockedPageIds.has(currentPageId) && (
                <Lock className="inline h-3.5 w-3.5 text-[#F4E5D1]" />
              )}
              {index === 0
                ? 'Beginning of the book'
                : `Page ${index} of ${pages.length}`}
            </span>

            <span>
              {currentElements.length}{' '}
              {currentElements.length === 1 ? 'piece' : 'pieces'}
            </span>
          </div>

          {/* BOOK SHELL */}
          <div
            className="relative [perspective:2400px]"
            style={{
              width: bookWidth,
              height: bookHeight,
              touchAction: 'pan-y',
            }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {/* TABLE SHADOW */}
            <div
              className="absolute -inset-10 -z-30"
              style={{
                background: 'rgba(54,32,15,.18)',
                boxShadow: '0 38px 45px rgba(35,20,8,.48)',
                transform: 'translateY(8px)',
              }}
            />

            {/* LEATHER / COVER BOARD */}
            <div className="absolute -inset-[10px] -z-20 border-[6px] border-[#452B1A] bg-[#684125] shadow-[8px_9px_0_#332014,0_28px_35px_rgba(42,25,12,.38)]">
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: `
                    repeating-linear-gradient(
                      0deg,
                      rgba(255,255,255,.025) 0,
                      rgba(255,255,255,.025) 1px,
                      transparent 1px,
                      transparent 5px
                    )
                  `,
                }}
              />
            </div>

            {/* PAGE BLOCK / THICKNESS */}
            {Array.from({ length: stackCount }).map((_, layer) => (
              <div
                key={layer}
                className="absolute z-0 border border-[#B5A38E] bg-[#E8DDCC]"
                style={{
                  inset: `${4 + layer * 0.75}px ${3 - layer * 0.08}px ${
                    4 - layer * 0.05
                  }px ${4 - layer * 0.5}px`,
                  transform: `translateX(${-layer * 1.35}px)`,
                  boxShadow:
                    layer === stackCount - 1
                      ? 'inset 5px 0 0 rgba(68,43,25,.18)'
                      : undefined,
                }}
              />
            ))}

            {/* MAIN PAGE FRAME */}
            <div className="absolute inset-[5px] z-10 overflow-hidden border-2 border-[#6E5742] bg-[#EFE3D2] shadow-[inset_11px_0_13px_rgba(49,31,18,.22),inset_-5px_0_7px_rgba(49,31,18,.11)]">
              {/* STITCHED BINDING */}
              <div className="pointer-events-none absolute inset-y-3 left-2 z-[80] w-[14px] border-r-2 border-dashed border-[#EDE0CA]/80 opacity-90" />

              <div className="pointer-events-none absolute inset-y-0 left-0 z-[79] w-8 bg-gradient-to-r from-[#392416]/25 to-transparent" />

              {/* PAGE — or the PIN gate when the page is locked */}
              {!turn && (
                <div
                  className="absolute inset-[7px] z-10 overflow-hidden border border-[#A18E79] bg-[#FFFDF8]"
                  style={{ boxShadow: '0 2px 4px rgba(45,27,15,.15)' }}
                >
                  {gateLocked ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#F4E8D8] px-6 text-center">
                      <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#76563A] bg-[#F6E9D5] shadow-[3px_3px_0_#806247]">
                        <Lock className="h-7 w-7 text-[#5D3D26]" />
                      </span>
                      <div>
                        <p className="font-serif text-lg font-bold">This page is private</p>
                        <p className="mt-1 text-xs text-[#765D48]">Enter the PIN to read it.</p>
                      </div>
                      <form onSubmit={verifyPin} className="w-full max-w-[240px] space-y-2">
                        <input
                          type="password"
                          inputMode="numeric"
                          value={pin}
                          onChange={(e) => {
                            setPin(e.target.value);
                            setPinError(null);
                          }}
                          placeholder="PIN"
                          autoFocus
                          className="w-full border-2 border-[#9A8066] bg-[#FFF9EF] p-3 text-center text-base tracking-[0.3em] outline-none"
                        />
                        {pinError && <p className="text-xs font-semibold text-red-700">{pinError}</p>}
                        <button
                          type="submit"
                          className="min-h-[44px] w-full border-2 border-[#2E1B11] bg-[#3A2518] px-4 py-2.5 text-sm font-semibold text-[#F5DCC0]"
                        >
                          Unlock page
                        </button>
                      </form>
                    </div>
                  ) : (
                    <PageSurface
                      background={currentBackground}
                      elements={currentElements}
                      isCover={index === 0}
                      pageNumber={index > 0 ? currentPage?.page_number : undefined}
                    />
                  )}
                </div>
              )}

              {/* PAGE TURN */}
              {turn && (
                <>
                  {/* TARGET PAGE UNDERNEATH */}
                  <div
                    className="absolute inset-[7px] z-10 overflow-hidden border border-[#A18E79] bg-[#FFFDF8]"
                    style={{ boxShadow: '0 2px 4px rgba(45,27,15,.12)' }}
                  >
                    <PageSurface
                      background={targetBackground}
                      elements={targetElements}
                      isCover={targetIndex === 0}
                      pageNumber={
                        targetIndex > 0 ? targetPage?.page_number : undefined
                      }
                    />
                  </div>

                  {/* PHYSICAL TURNING PAGE */}
                  <div
                    className="absolute inset-[7px] z-30 overflow-hidden border border-[#A18E79] bg-[#FFFDF8]"
                    style={{
                      transformStyle: 'preserve-3d',
                      transformOrigin:
                        turn === 'next' ? 'left center' : 'right center',
                      transform: `rotateY(${angle}deg)`,
                      willChange: 'transform',
                      boxShadow:
                        turn === 'next'
                          ? `${-(8 + curl * 14)}px 0 ${4 + curl * 12}px rgba(42,25,12,${
                              0.14 + curl * 0.25
                            })`
                          : `${8 + curl * 14}px 0 ${4 + curl * 12}px rgba(42,25,12,${
                              0.14 + curl * 0.25
                            })`,
                    }}
                  >
                    {/* FRONT */}
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        background: currentBackground,
                      }}
                    >
                      <PageSurface
                        background={currentBackground}
                        elements={currentElements}
                        isCover={index === 0}
                        pageNumber={index > 0 ? currentPage?.page_number : undefined}
                      />

                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 w-24"
                        style={{
                          opacity: curl,
                          background:
                            'linear-gradient(90deg, transparent, rgba(35,20,8,.22))',
                        }}
                      />
                    </div>

                    {/* BACK */}
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        background: targetBackground,
                      }}
                    >
                      <PageSurface
                        background={targetBackground}
                        elements={targetElements}
                        isCover={targetIndex === 0}
                        pageNumber={
                          targetIndex > 0 ? targetPage?.page_number : undefined
                        }
                      />

                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 w-24"
                        style={{
                          opacity: curl,
                          background:
                            'linear-gradient(90deg, rgba(35,20,8,.22), transparent)',
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* TAP ZONES */}
              {!turn && (
                <>
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={index === 0}
                    onClick={() => go('prev')}
                    className="absolute inset-y-0 left-0 z-[90] w-[22%] cursor-w-resize disabled:cursor-default"
                  />

                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={index === total - 1}
                    onClick={() => go('next')}
                    className="absolute inset-y-0 right-0 z-[90] w-[22%] cursor-e-resize disabled:cursor-default"
                  />
                </>
              )}
            </div>
          </div>

          {/* CONTROLS — grid on phones, row from sm up */}
          <div
            className="mt-5 grid w-full grid-cols-3 justify-items-stretch gap-2 sm:flex sm:justify-center"
            style={{ maxWidth: bookWidth }}
          >
            <button
              type="button"
              onClick={() => go('prev')}
              disabled={index === 0 || !!turn}
              className="flex min-h-[48px] items-center justify-center border-2 border-[#5D3D26] bg-[#EAD7BC] px-3 py-2.5 font-serif text-xs font-bold shadow-[3px_3px_0_#5D3D26] transition active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40 sm:px-4"
            >
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              Previous
            </button>

            <button
              type="button"
              onClick={openSeek}
              disabled={!!turn}
              className="flex min-h-[48px] items-center justify-center border-2 border-[#5D3D26] bg-[#EAD7BC] px-3 py-2.5 font-serif text-xs font-bold shadow-[3px_3px_0_#5D3D26] transition active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40 sm:px-4"
            >
              <Calendar className="mr-1 inline h-4 w-4" />
              Seek
            </button>

            <button
              type="button"
              onClick={() => go('next')}
              disabled={index === total - 1 || !!turn}
              className="flex min-h-[48px] items-center justify-center border-2 border-[#2E1B11] bg-[#3A2518] px-3 py-2.5 font-serif text-xs font-bold text-[#F5DCC0] shadow-[3px_3px_0_#1E110A] transition active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40 sm:px-4"
            >
              Next
              <ChevronRight className="ml-1 inline h-4 w-4" />
            </button>
          </div>

          <p
            className="mt-3 text-center font-serif text-[10px] text-[#F1DEC5]"
            style={{ maxWidth: bookWidth }}
          >
            Swipe, tap the page edge, or use the controls to turn the page.
          </p>
        </section>

        {/* ===================================== */}
        {/* BOOK INFORMATION                      */}
        {/* ===================================== */}

        <aside className="w-full max-w-[310px] border-2 border-[#68472D] bg-[#EAD7BC] p-5 text-center shadow-[7px_7px_0_#4C311F] lg:shrink-0">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-2 border-[#76563A] bg-[#F5E5CE] text-3xl shadow-[3px_3px_0_#806247]">
            📖
          </div>

          <h2 className="font-serif text-xl font-bold">{journal.title}</h2>

          <p className="mt-2 text-xs leading-5 text-[#654B37]">
            {journal.description ||
              journal.foreword ||
              'A collection of memories, notes, sketches, photographs and little pieces of life.'}
          </p>

          <div className="mt-5 border-t-2 border-[#B99C7B] pt-4 font-serif text-[10px] uppercase tracking-[.18em] text-[#765D48]">
            {index === 0 ? 'Cover' : `Page ${index} of ${pages.length}`}
          </div>

          <div className="mt-4 flex justify-center gap-2 text-[10px] text-[#765D48]">
            <span>{pages.length} pages</span>
            <span>•</span>
            <span>{currentElements.length} pieces</span>
          </div>
        </aside>
      </div>

      {/* ===================================== */}
      {/* SHARE MODAL                           */}
      {/* ===================================== */}

      {shareOpen && (
        <ShareJournalModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          journalId={journalId}
          journalTitle={journal.title}
          pageId={currentPageId}
          pageNumber={index > 0 ? index : null}
        />
      )}

      {/* ===================================== */}
      {/* SEEK MODAL                            */}
      {/* ===================================== */}

      {seekOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#24170F]/75 p-4">
          <div className="w-full max-w-sm border-2 border-[#5E3E28] bg-[#EAD7BC] p-5 shadow-[8px_8px_0_#3C2517]">
            <h3 className="mb-3 font-serif text-lg font-bold">Find a page</h3>

            <form onSubmit={seekDate} className="space-y-3">
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSeekError(null);
                }}
                required
                className="w-full border-2 border-[#9A8066] bg-[#FFF9EF] p-3 text-base outline-none"
              />

              {seekError && (
                <p className="border-2 border-red-900/30 bg-[#F5DADA] px-3 py-2 text-xs font-semibold text-red-900">
                  {seekError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSeekOpen(false)}
                  className="min-h-[44px] border-2 border-[#76563A] bg-[#F6E9D5] px-4 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="min-h-[44px] border-2 border-[#2E1B11] bg-[#3A2518] px-4 py-2.5 text-sm font-semibold text-[#F5DCC0]"
                >
                  Find
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
