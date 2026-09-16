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
  Eye,
  EyeOff,
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

  /*
   * Important:
   * A locked page can exist in the local page list without
   * having its actual elements/content loaded.
   */
  locked: boolean;
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

interface PageLockRow {
  page_id: string;
  journal_id?: string;
  locked?: boolean;
}

const TURN_MS = 520;

/* Book width bounds */
const MIN_BOOK_WIDTH = 280;
const MAX_BOOK_WIDTH = 500;

/* ------------------------------------------------
 * PAGE METADATA NORMALIZATION
 *
 * We intentionally support pages without elements.
 * Locked pages for non-owners are represented by
 * metadata only.
 * ------------------------------------------------ */

function normalizePageMetadata(
  raw: any,
  index: number,
): JournalPage | null {
  if (!raw?.id) {
    console.warn(
      `Skipping journal page ${index + 1}: missing database id.`,
      raw,
    );

    return null;
  }

  return {
    id: String(raw.id),
    page_number: Number(raw?.page_number ?? index + 1),
    title: raw?.title || `Page ${index + 1}`,
    background: raw?.background || '#FFFDF8',
    width: Number(raw?.width ?? CANVAS_WIDTH),
    height: Number(raw?.height ?? CANVAS_HEIGHT),

    /*
     * IMPORTANT:
     * This is intentionally empty initially.
     *
     * For a locked page, the actual content is NEVER
     * fetched for a non-owner.
     */
    elements: [],

    created_at:
      raw?.created_at || new Date().toISOString(),

    locked: false,
  };
}

function normalizePageContent(
  raw: any,
  fallback: JournalPage,
): JournalPage {
  return {
    ...fallback,
    title: raw?.title || fallback.title,
    background: raw?.background || fallback.background,
    width: Number(raw?.width ?? fallback.width),
    height: Number(raw?.height ?? fallback.height),
    elements: normalizeElements(raw?.elements),
    created_at:
      raw?.created_at || fallback.created_at,
    locked: false,
  };
}

function getPageTitle(
  pages: JournalPage[],
  index: number,
) {
  if (index <= 0) {
    return 'Cover';
  }

  const page = pages[index - 1];

  if (page?.locked) {
    return 'Private page';
  }

  return page?.title || `Page ${index}`;
}

export default function JournalBookView() {
  const params = useParams();
  const journalId = params?.journalId as string;

  const [journal, setJournal] =
    useState<Journal | null>(null);

  const [pages, setPages] =
    useState<JournalPage[]>([]);

  /* 0 = cover, 1 = first page, etc. */
  const [index, setIndex] = useState(0);

  const [loading, setLoading] =
    useState(true);

  const [turn, setTurn] =
    useState<'next' | 'prev' | null>(null);

  const [progress, setProgress] =
    useState(0);

  const [seekOpen, setSeekOpen] =
    useState(false);

  const [date, setDate] =
    useState('');

  const [seekError, setSeekError] =
    useState<string | null>(null);

  const [bookWidth, setBookWidth] =
    useState(MAX_BOOK_WIDTH);

  /* ------------------------------------------------
   * AUTH / LOCK STATE
   * ------------------------------------------------ */

  const [meId, setMeId] =
    useState<string | null>(null);

  const [shareOpen, setShareOpen] =
    useState(false);

  /*
   * Locked page IDs are kept separately so the
   * UI can immediately determine the page state.
   */
  const [lockedPageIds, setLockedPageIds] =
    useState<Set<string>>(new Set());

  /*
   * Pages successfully unlocked during this browser
   * session.
   */
  const [unlockedPages, setUnlockedPages] =
    useState<Set<string>>(new Set());

  const [pin, setPin] =
    useState('');

  const [pinError, setPinError] =
    useState<string | null>(null);

  const [pinLoading, setPinLoading] =
    useState(false);

  /*
   * Eye indicator state.
   */
  const [showPin, setShowPin] =
    useState(false);

  const [isMobile, setIsMobile] =
    useState(false);

  const touchStart =
    useRef<{ x: number; y: number } | null>(null);

  const animationRef =
    useRef<number | null>(null);

  const timeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------
   * WHO AM I
   * ------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!cancelled) {
        setMeId(user?.id || null);
      }
    }

    loadUser();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------------------------
   * LOAD JOURNAL + PAGE METADATA
   *
   * IMPORTANT SECURITY BEHAVIOR:
   *
   * We DO NOT immediately select elements for every
   * page.
   *
   * First we obtain only page metadata and determine
   * which pages are locked.
   *
   * Locked page content is fetched later only after
   * the page is authorized/unlocked.
   * ------------------------------------------------ */

  useEffect(() => {
    if (!journalId) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      /*
       * Get current user here so the initial load can
       * decide whether this is the owner.
       */
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) {
        return;
      }

      setMeId(user?.id || null);

      /*
       * Journal itself is safe to load because we need
       * owner_id and cover information.
       */
      const journalResult = await supabase
        .from('journals')
        .select('*')
        .eq('id', journalId)
        .single();

      if (cancelled) {
        return;
      }

      if (journalResult.error) {
        console.error(
          'Journal error:',
          journalResult.error,
        );

        setJournal(null);
        setLoading(false);
        return;
      }

      const loadedJournal =
        journalResult.data as Journal;

      setJournal(loadedJournal);

      const owner =
        !!user?.id &&
        user.id === loadedJournal.owner_id;

      /*
       * Only fetch metadata at first.
       *
       * NO elements column here.
       */
      const pagesResult = await supabase
        .from('journal_pages')
        .select(
          'id, journal_id, page_number, title, background, width, height, created_at',
        )
        .eq('journal_id', journalId)
        .order('page_number', {
          ascending: true,
        });

      if (cancelled) {
        return;
      }

      if (pagesResult.error) {
        console.error(
          'Page metadata error:',
          pagesResult.error,
        );

        setPages([]);
        setLoading(false);
        return;
      }

      const metadataPages =
        (pagesResult.data || [])
          .map(normalizePageMetadata)
          .filter(
            (
              page,
            ): page is JournalPage =>
              page !== null,
          );

      /*
       * Determine locks.
       *
       * Owner does not need the lock RPC for rendering,
       * but we still collect lock state so the UI can
       * display the lock badge.
       */
      const lockMap =
        new Map<string, boolean>();

      if (metadataPages.length > 0) {
        /*
         * Use the existing RPC individually because
         * get_page_lock already exists in the project.
         */
        await Promise.all(
          metadataPages.map(async (page) => {
            const { data, error } =
              await supabase.rpc(
                'get_page_lock',
                {
                  p_page_id: page.id,
                },
              );

            if (error) {
              console.warn(
                'Could not read page lock:',
                page.id,
                error.message,
              );

              lockMap.set(page.id, false);
              return;
            }

            const row =
              (data as PageLockRow[] | null)?.[0];

            lockMap.set(
              page.id,
              row?.locked === true,
            );
          }),
        );
      }

      if (cancelled) {
        return;
      }

      const lockedIds =
        new Set<string>();

      for (const page of metadataPages) {
        if (lockMap.get(page.id)) {
          lockedIds.add(page.id);
        }
      }

      setLockedPageIds(lockedIds);

      /*
       * ------------------------------------------------
       * FETCH CONTENT
       * ------------------------------------------------
       *
       * OWNER:
       *   Load every page.
       *
       * NON-OWNER:
       *   Load ONLY unlocked pages.
       *
       * Locked pages remain in the page array, but their
       * elements stay empty.
       */
      const pagesAllowedToLoad =
        owner
          ? metadataPages
          : metadataPages.filter(
              (page) =>
                !lockedIds.has(page.id),
            );

      let contentRows: any[] = [];

      if (pagesAllowedToLoad.length > 0) {
        const ids =
          pagesAllowedToLoad.map(
            (page) => page.id,
          );

        const contentResult =
          await supabase
            .from('journal_pages')
            .select('*')
            .in('id', ids)
            .eq('journal_id', journalId);

        if (cancelled) {
          return;
        }

        if (contentResult.error) {
          console.error(
            'Page content error:',
            contentResult.error,
          );
        } else {
          contentRows =
            contentResult.data || [];
        }
      }

      if (cancelled) {
        return;
      }

      const contentMap =
        new Map<string, any>();

      for (const row of contentRows) {
        if (row?.id) {
          contentMap.set(
            String(row.id),
            row,
          );
        }
      }

      const finalPages =
        metadataPages.map((page) => {
          const isLocked =
            lockedIds.has(page.id);

          /*
           * A locked non-owner page intentionally has
           * NO content attached.
           */
          if (
            isLocked &&
            !owner
          ) {
            return {
              ...page,
              elements: [],
              locked: true,
            };
          }

          const content =
            contentMap.get(page.id);

          if (!content) {
            return {
              ...page,
              elements: [],
              locked: isLocked,
            };
          }

          return {
            ...normalizePageContent(
              content,
              page,
            ),
            locked: isLocked,
          };
        });

      setPages(finalPages);
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;

      if (animationRef.current) {
        cancelAnimationFrame(
          animationRef.current,
        );
      }

      if (timeoutRef.current) {
        clearTimeout(
          timeoutRef.current,
        );
      }
    };
  }, [journalId]);

  /* ------------------------------------------------
   * CURRENT PAGE LOCK
   * ------------------------------------------------ */

  const currentPageId =
    index === 0
      ? null
      : pages[index - 1]?.id || null;

  const isOwner =
    !!meId &&
    meId === journal?.owner_id;

  const currentPageLocked =
    !!currentPageId &&
    lockedPageIds.has(currentPageId);

  const gateLocked =
    !!currentPageId &&
    currentPageLocked &&
    !unlockedPages.has(currentPageId) &&
    !isOwner;

  /* ------------------------------------------------
   * PIN VERIFICATION
   *
   * The password is NOT hashed in the browser.
   *
   * The server-side Supabase RPC should compare the
   * submitted PIN against the stored pgcrypto hash.
   * ------------------------------------------------ */

  const verifyPin = async (
    e: React.FormEvent,
  ) => {
    e.preventDefault();

    if (
      !currentPageId ||
      !pin.trim() ||
      pinLoading
    ) {
      return;
    }

    setPinLoading(true);
    setPinError(null);

    try {
      const { data, error } =
        await supabase.rpc(
          'verify_page_pin',
          {
            p_page_id: currentPageId,
            p_pin: pin.trim(),
          },
        );

      if (error) {
        console.error(
          'PIN verification error:',
          error,
        );

        setPinError(
          error.message ||
            'Could not verify the PIN.',
        );

        setPin('');
        return;
      }

      if (data === true) {
        /*
         * Unlock only this page.
         */
        setUnlockedPages(
          (previous) => {
            const next =
              new Set(previous);

            next.add(currentPageId);

            return next;
          },
        );

        /*
         * We intentionally reload only the unlocked
         * page content after successful verification.
         *
         * This keeps locked content out of the initial
         * response.
         */
        const { data: pageData, error: pageError } =
          await supabase
            .from('journal_pages')
            .select('*')
            .eq('id', currentPageId)
            .eq('journal_id', journalId)
            .single();

        if (pageError) {
          console.error(
            'Could not load unlocked page:',
            pageError,
          );

          setPinError(
            'The PIN was correct, but the page could not be loaded.',
          );

          return;
        }

        setPages(
          (previous) =>
            previous.map((page) => {
              if (
                page.id !==
                currentPageId
              ) {
                return page;
              }

              return {
                ...normalizePageContent(
                  pageData,
                  page,
                ),
                locked: true,
              };
            }),
        );

        setPin('');
        setPinError(null);
        setShowPin(false);
      } else {
        setPinError(
          'Wrong PIN — try again.',
        );

        setPin('');
      }
    } finally {
      setPinLoading(false);
    }
  };

  /* ------------------------------------------------
   * VIEWPORT TRACKING
   * ------------------------------------------------ */

  useEffect(() => {
    const update = () => {
      setIsMobile(
        window.innerWidth < 1024,
      );
    };

    update();

    window.addEventListener(
      'resize',
      update,
    );

    window.addEventListener(
      'orientationchange',
      update,
    );

    return () => {
      window.removeEventListener(
        'resize',
        update,
      );

      window.removeEventListener(
        'orientationchange',
        update,
      );
    };
  }, []);

  /* ------------------------------------------------
   * RESPONSIVE BOOK SIZE
   * ------------------------------------------------ */

  useEffect(() => {
    function updateSize() {
      const width =
        window.innerWidth;

      const height =
        window.innerHeight;

      const desktop =
        width >= 1024;

      const mobileVerticalChrome =
        isMobile ? 210 : 190;

      const desktopVerticalChrome =
        190;

      const horizontalChrome =
        isMobile ? 46 : 90;

      const mobileWidth =
        Math.min(
          MAX_BOOK_WIDTH,
          width -
            horizontalChrome,
        );

      const mobileHeight =
        Math.floor(
          (height -
            mobileVerticalChrome) *
            (CANVAS_WIDTH /
              CANVAS_HEIGHT),
        );

      const desktopWidth =
        Math.min(
          MAX_BOOK_WIDTH,
          Math.floor(
            width * 0.42,
          ),
        );

      const desktopHeight =
        Math.floor(
          (height -
            desktopVerticalChrome) *
            (CANVAS_WIDTH /
              CANVAS_HEIGHT),
        );

      const calculated =
        desktop
          ? Math.min(
              desktopWidth,
              desktopHeight,
            )
          : Math.min(
              mobileWidth,
              mobileHeight,
            );

      setBookWidth(
        Math.max(
          MIN_BOOK_WIDTH,
          calculated,
        ),
      );
    }

    updateSize();

    window.addEventListener(
      'resize',
      updateSize,
    );

    window.addEventListener(
      'orientationchange',
      updateSize,
    );

    return () => {
      window.removeEventListener(
        'resize',
        updateSize,
      );

      window.removeEventListener(
        'orientationchange',
        updateSize,
      );
    };
  }, [isMobile]);

  /* ------------------------------------------------
   * BOOK DATA
   * ------------------------------------------------ */

  const total =
    pages.length + 1;

  const targetIndex =
    turn === 'next'
      ? Math.min(
          total - 1,
          index + 1,
        )
      : turn === 'prev'
        ? Math.max(
            0,
            index - 1,
          )
        : index;

  const currentPage =
    index === 0
      ? null
      : pages[index - 1] ||
        null;

  const targetPage =
    targetIndex === 0
      ? null
      : pages[
          targetIndex - 1
        ] || null;

  /* ------------------------------------------------
   * IMPORTANT:
   *
   * Never use locked page content for a non-owner.
   * ------------------------------------------------ */

  const currentElements =
    useMemo(() => {
      if (index === 0) {
        return normalizeElements(
          journal?.cover_elements,
        );
      }

      if (
        currentPage?.locked &&
        !isOwner &&
        !unlockedPages.has(
          currentPage.id,
        )
      ) {
        return [];
      }

      return (
        currentPage?.elements ||
        []
      );
    }, [
      index,
      journal?.cover_elements,
      currentPage,
      isOwner,
      unlockedPages,
    ]);

  const targetElements =
    useMemo(() => {
      if (targetIndex === 0) {
        return normalizeElements(
          journal?.cover_elements,
        );
      }

      if (
        targetPage?.locked &&
        !isOwner &&
        !unlockedPages.has(
          targetPage.id,
        )
      ) {
        return [];
      }

      return (
        targetPage?.elements ||
        []
      );
    }, [
      targetIndex,
      journal?.cover_elements,
      targetPage,
      isOwner,
      unlockedPages,
    ]);

  const currentBackground =
    index === 0
      ? journal?.background_color ||
        '#FFF7F8'
      : currentPage?.background ||
        '#FFFDF8';

  const targetBackground =
    targetIndex === 0
      ? journal?.background_color ||
        '#FFF7F8'
      : targetPage?.background ||
        '#FFFDF8';

  const pageScale =
    bookWidth / CANVAS_WIDTH;

  const bookHeight =
    bookWidth *
    (CANVAS_HEIGHT /
      CANVAS_WIDTH);

  /* ------------------------------------------------
   * PAGE SURFACE
   * ------------------------------------------------ */

  function PageSurface({
    background,
    elements,
    isCover = false,
    pageNumber,
    coverMediaUrl,
    coverMediaType,
  }: {
    background: string;
    elements: CanvasElement[];
    isCover?: boolean;
    pageNumber?: number;
    coverMediaUrl?: string;
    coverMediaType?: string;
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
        {isCover &&
          coverMediaUrl && (
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
              {String(
                coverMediaType || '',
              )
                .toLowerCase()
                .startsWith(
                  'video/',
                ) ||
              String(
                coverMediaType || '',
              ).toLowerCase() ===
                'video' ? (
                <video
                  src={
                    coverMediaUrl
                  }
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={
                    coverMediaUrl
                  }
                  alt=""
                  draggable={false}
                  loading="eager"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-full w-full select-none object-cover"
                />
              )}
            </div>
          )}

        <div className="relative z-10">
          <JournalCanvasRenderer
            elements={elements}
            scale={pageScale}
            className="absolute left-0 top-0"
          />
        </div>

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

        {!isCover &&
          pageNumber != null && (
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

  function go(
    direction: 'next' | 'prev',
  ) {
    if (turn) {
      return;
    }

    const canMove =
      direction === 'next'
        ? index < total - 1
        : index > 0;

    if (!canMove) {
      return;
    }

    setTurn(direction);
    setProgress(0);

    const started =
      performance.now();

    function frame(
      now: number,
    ) {
      const raw =
        Math.min(
          1,
          (now - started) /
            TURN_MS,
        );

      const eased =
        1 -
        Math.pow(
          1 - raw,
          2.4,
        );

      setProgress(eased);

      if (raw < 1) {
        animationRef.current =
          requestAnimationFrame(
            frame,
          );
      }
    }

    animationRef.current =
      requestAnimationFrame(
        frame,
      );

    timeoutRef.current =
      setTimeout(() => {
        setIndex(
          (value) =>
            direction ===
            'next'
              ? Math.min(
                  total - 1,
                  value + 1,
                )
              : Math.max(
                  0,
                  value - 1,
                ),
        );

        setTurn(null);
        setProgress(0);
      }, TURN_MS);
  }

  /* ------------------------------------------------
   * SWIPE
   * ------------------------------------------------ */

  function onTouchStart(
    event: React.TouchEvent,
  ) {
    if (turn) {
      return;
    }

    const touch =
      event.touches[0];

    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function onTouchEnd(
    event: React.TouchEvent,
  ) {
    if (
      !touchStart.current ||
      turn
    ) {
      return;
    }

    const touch =
      event.changedTouches[0];

    const dx =
      touch.clientX -
      touchStart.current.x;

    const dy =
      touch.clientY -
      touchStart.current.y;

    touchStart.current = null;

    if (
      Math.abs(dx) < 45 ||
      Math.abs(dx) <=
        Math.abs(dy)
    ) {
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

  function seekDate(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    const found =
      pages.findIndex(
        (page) =>
          page.created_at?.startsWith(
            date,
          ),
      );

    if (found < 0) {
      setSeekError(
        'No entry found for that date.',
      );

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

  const remaining =
    turn === 'next'
      ? total - index - 1
      : index;

  const stackCount =
    Math.max(
      2,
      Math.min(
        18,
        Math.ceil(
          Math.max(
            1,
            remaining,
          ) / 2,
        ),
      ),
    );

  const angle =
    turn === 'next'
      ? -180 * progress
      : turn === 'prev'
        ? 180 * progress
        : 0;

  const curl =
    Math.sin(
      progress * Math.PI,
    );

  /* ------------------------------------------------
   * LOADING
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

  /* ------------------------------------------------
   * JOURNAL NOT FOUND
   * ------------------------------------------------ */

  if (!journal) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#8E6847] px-6 font-serif text-[#2F2015]">
        <p>
          Journal not found.
        </p>

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
        backgroundColor:
          '#B88C5A',

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
      {/* HEADER                                */}
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
              {getPageTitle(
                pages,
                index,
              )}
            </p>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={() =>
                setShareOpen(true)
              }
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
          style={{
            maxWidth:
              bookWidth + 50,
          }}
        >
          {/* Top information */}

          <div
            className="mb-2 flex w-full items-center justify-between px-1 font-serif text-[11px] text-[#F4E5D1]"
            style={{
              maxWidth: bookWidth,
            }}
          >
            <span className="inline-flex items-center gap-1">
              {currentPageId &&
                currentPageLocked && (
                  <Lock className="inline h-3.5 w-3.5 text-[#F4E5D1]" />
                )}

              {index === 0
                ? 'Beginning of the book'
                : gateLocked
                  ? 'Private page'
                  : `Page ${index} of ${pages.length}`}
            </span>

            <span>
              {gateLocked
                ? 'Private'
                : `${currentElements.length} ${
                    currentElements.length ===
                    1
                      ? 'piece'
                      : 'pieces'
                  }`}
            </span>
          </div>

          {/* ================================= */}
          {/* BOOK SHELL                         */}
          {/* ================================= */}

          <div
            className="relative [perspective:2400px]"
            style={{
              width: bookWidth,
              height: bookHeight,
              touchAction: 'pan-y',
            }}
            onTouchStart={
              onTouchStart
            }
            onTouchEnd={
              onTouchEnd
            }
          >
            {/* TABLE SHADOW */}

            <div
              className="absolute -inset-10 -z-30"
              style={{
                background:
                  'rgba(54,32,15,.18)',
                boxShadow:
                  '0 38px 45px rgba(35,20,8,.48)',
                transform:
                  'translateY(8px)',
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

            {Array.from({
              length: stackCount,
            }).map(
              (_, layer) => (
                <div
                  key={layer}
                  className="absolute z-0 border border-[#B5A38E] bg-[#E8DDCC]"
                  style={{
                    inset: `${
                      4 +
                      layer *
                        0.75
                    }px ${
                      3 -
                      layer *
                        0.08
                    }px ${
                      4 -
                      layer *
                        0.05
                    }px ${
                      4 -
                      layer *
                        0.5
                    }px`,

                    transform: `translateX(${
                      -layer *
                      1.35
                    }px)`,

                    boxShadow:
                      layer ===
                      stackCount -
                        1
                        ? 'inset 5px 0 0 rgba(68,43,25,.18)'
                        : undefined,
                  }}
                />
              ),
            )}

            {/* MAIN PAGE FRAME */}

            <div className="absolute inset-[5px] z-10 overflow-hidden border-2 border-[#6E5742] bg-[#EFE3D2] shadow-[inset_11px_0_13px_rgba(49,31,18,.22),inset_-5px_0_7px_rgba(49,31,18,.11)]">
              {/* STITCHED BINDING */}

              <div className="pointer-events-none absolute inset-y-3 left-2 z-[80] w-[14px] border-r-2 border-dashed border-[#EDE0CA]/80 opacity-90" />

              <div className="pointer-events-none absolute inset-y-0 left-0 z-[79] w-8 bg-gradient-to-r from-[#392416]/25 to-transparent" />

              {/* ================================= */}
              {/* STATIC PAGE / PIN GATE             */}
              {/* ================================= */}

              {!turn && (
                <div
                  className="absolute inset-[7px] z-10 overflow-hidden border border-[#A18E79] bg-[#FFFDF8]"
                  style={{
                    boxShadow:
                      '0 2px 4px rgba(45,27,15,.15)',
                  }}
                >
                  {gateLocked ? (
                    /* =================================
                     * PRIVATE PAGE
                     * ================================= */

                    <div className="relative flex h-full flex-col items-center justify-center gap-4 bg-[#F4E8D8] px-6 text-center">
                      {/* Decorative locked-page background */}

                      <div className="pointer-events-none absolute inset-0 opacity-30">
                        <div className="absolute left-[15%] top-[18%] h-24 w-24 rotate-12 rounded-full border border-[#76563A]/30" />

                        <div className="absolute bottom-[18%] right-[12%] h-20 w-20 -rotate-12 rounded-full border border-[#76563A]/20" />
                      </div>

                      {/* Lock icon */}

                      <span className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#76563A] bg-[#F6E9D5] shadow-[3px_3px_0_#806247]">
                        <Lock className="h-7 w-7 text-[#5D3D26]" />
                      </span>

                      <div className="relative">
                        <p className="font-serif text-lg font-bold">
                          This page is private
                        </p>

                        <p className="mt-1 text-xs leading-5 text-[#765D48]">
                          This page is
                          protected.
                          Enter the
                          PIN to
                          continue
                          reading.
                        </p>
                      </div>

                      {/* PIN FORM */}

                      <form
                        onSubmit={
                          verifyPin
                        }
                        className="relative w-full max-w-[260px] space-y-2.5"
                      >
                        <div className="relative">
                          <input
                            type={
                              showPin
                                ? 'text'
                                : 'password'
                            }
                            inputMode="numeric"
                            autoComplete="off"
                            value={pin}
                            onChange={(
                              e,
                            ) => {
                              /*
                               * Keep the PIN input numeric
                               * while allowing pasted values.
                               */
                              const value =
                                e.target.value.replace(
                                  /\D/g,
                                  '',
                                );

                              setPin(
                                value,
                              );

                              setPinError(
                                null,
                              );
                            }}
                            placeholder="Enter PIN"
                            autoFocus
                            disabled={
                              pinLoading
                            }
                            className="h-12 w-full border-2 border-[#9A8066] bg-[#FFF9EF] px-4 pr-12 text-center text-base tracking-[0.3em] outline-none transition focus:border-[#5D3D26] disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Page PIN"
                          />

                          {/* EYE INDICATOR */}

                          <button
                            type="button"
                            onClick={() =>
                              setShowPin(
                                (value) =>
                                  !value,
                              )
                            }
                            disabled={
                              pinLoading
                            }
                            aria-label={
                              showPin
                                ? 'Hide PIN'
                                : 'Show PIN'
                            }
                            className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center text-[#76563A] transition hover:bg-[#EAD7BC] disabled:opacity-40"
                          >
                            {showPin ? (
                              <EyeOff className="h-5 w-5" />
                            ) : (
                              <Eye className="h-5 w-5" />
                            )}
                          </button>
                        </div>

                        {pinError && (
                          <p
                            role="alert"
                            className="border-2 border-red-900/20 bg-[#F5DADA] px-3 py-2 text-xs font-semibold text-red-900"
                          >
                            {
                              pinError
                            }
                          </p>
                        )}

                        <button
                          type="submit"
                          disabled={
                            pinLoading ||
                            !pin.trim()
                          }
                          className="min-h-[46px] w-full border-2 border-[#2E1B11] bg-[#3A2518] px-4 py-2.5 text-sm font-semibold text-[#F5DCC0] shadow-[3px_3px_0_#1E110A] transition active:translate-x-[1px] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pinLoading
                            ? 'Checking…'
                            : 'Unlock page'}
                        </button>
                      </form>

                      <p className="relative max-w-[260px] text-[9px] leading-4 text-[#8A715A]">
                        The PIN is verified
                        securely. Your
                        PIN is never
                        displayed or
                        stored in this
                        page.
                      </p>
                    </div>
                  ) : (
                    /* =================================
                     * NORMAL PAGE
                     * ================================= */

                    <PageSurface
                      background={
                        currentBackground
                      }
                      elements={
                        currentElements
                      }
                      isCover={
                        index === 0
                      }
                      coverMediaUrl={
                        index === 0
                          ? journal?.cover_media_url ||
                            journal?.cover_url ||
                            ''
                          : undefined
                      }
                      coverMediaType={
                        index === 0
                          ? journal?.cover_media_type ||
                            journal?.cover_type ||
                            ''
                          : undefined
                      }
                      pageNumber={
                        index > 0
                          ? currentPage?.page_number
                          : undefined
                      }
                    />
                  )}
                </div>
              )}

              {/* ================================= */}
              {/* PAGE TURN                         */}
              {/* ================================= */}

              {turn && (
                <>
                  {/* TARGET PAGE UNDERNEATH */}

                  <div
                    className="absolute inset-[7px] z-10 overflow-hidden border border-[#A18E79] bg-[#FFFDF8]"
                    style={{
                      boxShadow:
                        '0 2px 4px rgba(45,27,15,.12)',
                    }}
                  >
                    {targetPage?.locked &&
                    !isOwner &&
                    !unlockedPages.has(
                      targetPage.id,
                    ) ? (
                      /*
                       * IMPORTANT:
                       * A locked target page is never
                       * rendered during the turn.
                       */
                      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#F4E8D8] px-6 text-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#76563A] bg-[#F6E9D5] shadow-[3px_3px_0_#806247]">
                          <Lock className="h-6 w-6 text-[#5D3D26]" />
                        </span>

                        <div>
                          <p className="font-serif text-base font-bold">
                            Private page
                          </p>

                          <p className="mt-1 text-[10px] text-[#765D48]">
                            PIN required
                          </p>
                        </div>
                      </div>
                    ) : (
                      <PageSurface
                        background={
                          targetBackground
                        }
                        elements={
                          targetElements
                        }
                        isCover={
                          targetIndex ===
                          0
                        }
                        coverMediaUrl={
                          targetIndex ===
                          0
                            ? journal?.cover_media_url ||
                              journal?.cover_url ||
                              ''
                            : undefined
                        }
                        coverMediaType={
                          targetIndex ===
                          0
                            ? journal?.cover_media_type ||
                              journal?.cover_type ||
                              ''
                            : undefined
                        }
                        pageNumber={
                          targetIndex >
                          0
                            ? targetPage?.page_number
                            : undefined
                        }
                      />
                    )}
                  </div>

                  {/* PHYSICAL TURNING PAGE */}

                  <div
                    className="absolute inset-[7px] z-30 overflow-hidden border border-[#A18E79] bg-[#FFFDF8]"
                    style={{
                      transformStyle:
                        'preserve-3d',

                      transformOrigin:
                        turn ===
                        'next'
                          ? 'left center'
                          : 'right center',

                      transform: `rotateY(${angle}deg)`,

                      willChange:
                        'transform',

                      boxShadow:
                        turn ===
                        'next'
                          ? `${-(8 + curl * 14)}px 0 ${
                              4 +
                              curl *
                                12
                            }px rgba(42,25,12,${
                              0.14 +
                              curl *
                                0.25
                            })`
                          : `${8 + curl * 14}px 0 ${
                              4 +
                              curl *
                                12
                            }px rgba(42,25,12,${
                              0.14 +
                              curl *
                                0.25
                            })`,
                    }}
                  >
                    {/* FRONT */}

                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        backfaceVisibility:
                          'hidden',

                        WebkitBackfaceVisibility:
                          'hidden',

                        background:
                          currentBackground,
                      }}
                    >
                      {currentPage?.locked &&
                      !isOwner &&
                      !unlockedPages.has(
                        currentPage.id,
                      ) ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#F4E8D8] px-6 text-center">
                          <Lock className="h-7 w-7 text-[#5D3D26]" />

                          <p className="font-serif text-base font-bold">
                            Private page
                          </p>
                        </div>
                      ) : (
                        <PageSurface
                          background={
                            currentBackground
                          }
                          elements={
                            currentElements
                          }
                          isCover={
                            index ===
                            0
                          }
                          coverMediaUrl={
                            index ===
                            0
                              ? journal?.cover_media_url ||
                                journal?.cover_url ||
                                ''
                              : undefined
                          }
                          coverMediaType={
                            index ===
                            0
                              ? journal?.cover_media_type ||
                                journal?.cover_type ||
                                ''
                              : undefined
                          }
                          pageNumber={
                            index >
                            0
                              ? currentPage?.page_number
                              : undefined
                          }
                        />
                      )}

                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 w-24"
                        style={{
                          opacity:
                            curl,

                          background:
                            'linear-gradient(90deg, transparent, rgba(35,20,8,.22))',
                        }}
                      />
                    </div>

                    {/* BACK */}

                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        backfaceVisibility:
                          'hidden',

                        WebkitBackfaceVisibility:
                          'hidden',

                        transform:
                          'rotateY(180deg)',

                        background:
                          targetBackground,
                      }}
                    >
                      {targetPage?.locked &&
                      !isOwner &&
                      !unlockedPages.has(
                        targetPage.id,
                      ) ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#F4E8D8] px-6 text-center">
                          <Lock className="h-7 w-7 text-[#5D3D26]" />

                          <p className="font-serif text-base font-bold">
                            Private page
                          </p>
                        </div>
                      ) : (
                        <PageSurface
                          background={
                            targetBackground
                          }
                          elements={
                            targetElements
                          }
                          isCover={
                            targetIndex ===
                            0
                          }
                          coverMediaUrl={
                            targetIndex ===
                            0
                              ? journal?.cover_media_url ||
                                journal?.cover_url ||
                                ''
                              : undefined
                          }
                          coverMediaType={
                            targetIndex ===
                            0
                              ? journal?.cover_media_type ||
                                journal?.cover_type ||
                                ''
                              : undefined
                          }
                          pageNumber={
                            targetIndex >
                            0
                              ? targetPage?.page_number
                              : undefined
                          }
                        />
                      )}

                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 w-24"
                        style={{
                          opacity:
                            curl,

                          background:
                            'linear-gradient(90deg, rgba(35,20,8,.22), transparent)',
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ================================= */}
              {/* TAP ZONES                         */}
              {/* ================================= */}

              {!turn && (
                <>
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={
                      index === 0
                    }
                    onClick={() =>
                      go('prev')
                    }
                    className="absolute inset-y-0 left-0 z-[90] w-[22%] cursor-w-resize disabled:cursor-default"
                  />

                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={
                      index ===
                      total - 1
                    }
                    onClick={() =>
                      go('next')
                    }
                    className="absolute inset-y-0 right-0 z-[90] w-[22%] cursor-e-resize disabled:cursor-default"
                  />
                </>
              )}
            </div>
          </div>

          {/* ================================= */}
          {/* CONTROLS                          */}
          {/* ================================= */}

          <div
            className="mt-5 grid w-full grid-cols-3 justify-items-stretch gap-2 sm:flex sm:justify-center"
            style={{
              maxWidth: bookWidth,
            }}
          >
            <button
              type="button"
              onClick={() =>
                go('prev')
              }
              disabled={
                index === 0 ||
                !!turn
              }
              className="flex min-h-[48px] items-center justify-center border-2 border-[#5D3D26] bg-[#EAD7BC] px-3 py-2.5 font-serif text-xs font-bold shadow-[3px_3px_0_#5D3D26] transition active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40 sm:px-4"
            >
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              Previous
            </button>

            <button
              type="button"
              onClick={
                openSeek
              }
              disabled={!!turn}
              className="flex min-h-[48px] items-center justify-center border-2 border-[#5D3D26] bg-[#EAD7BC] px-3 py-2.5 font-serif text-xs font-bold shadow-[3px_3px_0_#5D3D26] transition active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40 sm:px-4"
            >
              <Calendar className="mr-1 inline h-4 w-4" />
              Seek
            </button>

            <button
              type="button"
              onClick={() =>
                go('next')
              }
              disabled={
                index ===
                  total - 1 ||
                !!turn
              }
              className="flex min-h-[48px] items-center justify-center border-2 border-[#2E1B11] bg-[#3A2518] px-3 py-2.5 font-serif text-xs font-bold text-[#F5DCC0] shadow-[3px_3px_0_#1E110A] transition active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40 sm:px-4"
            >
              Next
              <ChevronRight className="ml-1 inline h-4 w-4" />
            </button>
          </div>

          <p
            className="mt-3 text-center font-serif text-[10px] text-[#F1DEC5]"
            style={{
              maxWidth: bookWidth,
            }}
          >
            Swipe, tap the page edge,
            or use the controls to turn
            the page.
          </p>
        </section>

        {/* ===================================== */}
        {/* BOOK INFORMATION                      */}
        {/* ===================================== */}

        <aside className="w-full max-w-[310px] border-2 border-[#68472D] bg-[#EAD7BC] p-5 text-center shadow-[7px_7px_0_#4C311F] lg:shrink-0">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-2 border-[#76563A] bg-[#F5E5CE] text-3xl shadow-[3px_3px_0_#806247]">
            📖
          </div>

          <h2 className="font-serif text-xl font-bold">
            {journal.title}
          </h2>

          <p className="mt-2 text-xs leading-5 text-[#654B37]">
            {journal.description ||
              journal.foreword ||
              'A collection of memories, notes, sketches, photographs and little pieces of life.'}
          </p>

          <div className="mt-5 border-t-2 border-[#B99C7B] pt-4 font-serif text-[10px] uppercase tracking-[.18em] text-[#765D48]">
            {index === 0
              ? 'Cover'
              : gateLocked
                ? 'Private page'
                : `Page ${index} of ${pages.length}`}
          </div>

          <div className="mt-4 flex justify-center gap-2 text-[10px] text-[#765D48]">
            <span>
              {pages.length}{' '}
              pages
            </span>

            <span>•</span>

            <span>
              {gateLocked
                ? 'Private'
                : `${currentElements.length} pieces`}
            </span>
          </div>
        </aside>
      </div>

      {/* ===================================== */}
      {/* SHARE MODAL                           */}
      {/* ===================================== */}

      {shareOpen && (
        <ShareJournalModal
          isOpen={
            shareOpen
          }
          onClose={() =>
            setShareOpen(
              false,
            )
          }
          journalId={
            journalId
          }
          journalTitle={
            journal.title
          }
          pageId={
            currentPageId
          }
          pageNumber={
            index > 0
              ? index
              : null
          }
        />
      )}

      {/* ===================================== */}
      {/* SEEK MODAL                            */}
      {/* ===================================== */}

      {seekOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#24170F]/75 p-4">
          <div className="w-full max-w-sm border-2 border-[#5E3E28] bg-[#EAD7BC] p-5 shadow-[8px_8px_0_#3C2517]">
            <h3 className="mb-3 font-serif text-lg font-bold">
              Find a page
            </h3>

            <form
              onSubmit={
                seekDate
              }
              className="space-y-3"
            >
              <input
                type="date"
                value={date}
                onChange={(
                  event,
                ) => {
                  setDate(
                    event.target
                      .value,
                  );

                  setSeekError(
                    null,
                  );
                }}
                required
                className="w-full border-2 border-[#9A8066] bg-[#FFF9EF] p-3 text-base outline-none"
              />

              {seekError && (
                <p className="border-2 border-red-900/30 bg-[#F5DADA] px-3 py-2 text-xs font-semibold text-red-900">
                  {
                    seekError
                  }
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSeekOpen(
                      false,
                    )
                  }
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