"use client";

import {
  Archive,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileVideo,
  Filter,
  History,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Status =
  | "draft"
  | "pending"
  | "published"
  | "rejected"
  | "archived";

type Template = {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: unknown;
  project: unknown;
  aspect_ratio: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  premium: boolean;
  price_cents: number;
  currency: string;
  status: Status;
  rejection_reason: string | null;
  featured: boolean;
  views: number;
  uses: number;
  saves: number;
  rating_sum: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  published_at: string | null;

  creator:
    | {
        id: string;
        username: string | null;
        full_text_name: string | null;
        avatar_url: string | null;
        is_creator: boolean;
        creator_verified: boolean;
      }
    | {
        id: string;
        username: string | null;
        full_text_name: string | null;
        avatar_url: string | null;
        is_creator: boolean;
        creator_verified: boolean;
      }[]
    | null;
};

type Review = {
  id: string;
  template_id: string;
  reviewer_id: string;
  action:
    | "submitted"
    | "approved"
    | "rejected"
    | "resubmitted"
    | "archived";
  note: string | null;
  previous_status: string | null;
  new_status: string | null;
  created_at: string;

  reviewer:
    | {
        id: string;
        username: string | null;
        full_text_name: string | null;
        avatar_url: string | null;
      }
    | {
        id: string;
        username: string | null;
        full_text_name: string | null;
        avatar_url: string | null;
      }[]
    | null;
};

type Props = {
  initialTemplates?: Template[];
  initialReviews?: Review[];

  adminProfile: {
    id: string;
    username: string | null;
    full_text_name: string | null;
    avatar_url: string | null;
    is_admin: boolean;
  };
};

const statuses: Array<{
  value: "all" | Status;
  label: string;
}> = [
  {
    value: "all",
    label: "All",
  },
  {
    value: "pending",
    label: "Pending",
  },
  {
    value: "published",
    label: "Published",
  },
  {
    value: "rejected",
    label: "Rejected",
  },
  {
    value: "draft",
    label: "Draft",
  },
  {
    value: "archived",
    label: "Archived",
  },
];

function getCreator(creator: Template["creator"]) {
  if (Array.isArray(creator)) {
    return creator[0] ?? null;
  }

  return creator;
}

function getReviewer(reviewer: Review["reviewer"]) {
  if (Array.isArray(reviewer)) {
    return reviewer[0] ?? null;
  }

  return reviewer;
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) {
    return "—";
  }

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;

  return `${minutes}:${remaining
    .toString()
    .padStart(2, "0")}`;
}

function formatPrice(
  cents: number | null,
  currency: string | null,
) {
  if (!cents || cents <= 0) {
    return "Free";
  }

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${
      currency || "USD"
    }`;
  }
}

function statusLabel(status: Status) {
  switch (status) {
    case "pending":
      return "Pending review";

    case "published":
      return "Published";

    case "rejected":
      return "Rejected";

    case "archived":
      return "Archived";

    case "draft":
      return "Draft";

    default:
      return status;
  }
}

function statusClasses(status: Status) {
  switch (status) {
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";

    case "published":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";

    case "rejected":
      return "border-red-200 bg-red-50 text-red-700";

    case "archived":
      return "border-slate-200 bg-slate-100 text-slate-600";

    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function normalizeTemplate(
  row: any,
): Template {
  return {
    ...row,

    description: row.description ?? null,
    category: row.category ?? null,
    aspect_ratio: row.aspect_ratio ?? null,
    duration_seconds:
      row.duration_seconds ?? null,

    creator:
      row.creator ??
      row.profiles ??
      null,
  } as Template;
}

function normalizeReview(
  row: any,
): Review {
  return {
    ...row,

    reviewer:
      row.reviewer ??
      row.profiles ??
      null,
  } as Review;
}

export default function TemplateReviewDashboard({
  initialTemplates = [],
  initialReviews = [],
  adminProfile,
}: Props) {
  const [templates, setTemplates] =
    useState<Template[]>(initialTemplates);

  const [reviews, setReviews] =
    useState<Review[]>(initialReviews);

  const [selectedTemplateId, setSelectedTemplateId] =
    useState<string | null>(
      initialTemplates[0]?.id ?? null,
    );

  const [statusFilter, setStatusFilter] =
    useState<"all" | Status>("pending");

  const [search, setSearch] = useState("");

  const [busyAction, setBusyAction] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [notice, setNotice] =
    useState<{
      type: "success" | "error";
      message: string;
    } | null>(null);

  const [rejectReason, setRejectReason] =
    useState("");

  const [reviewNote, setReviewNote] =
    useState("");

  const [showRejectDialog, setShowRejectDialog] =
    useState(false);

  const [showHistory, setShowHistory] =
    useState(false);

  /*
   * Load templates and review history.
   *
   * This uses the existing exported `supabase`
   * client from @/lib/supabase/client.
   */
  async function loadTemplates() {
    setLoading(true);

    try {
      const {
        data: templateData,
        error: templateError,
      } = await supabase
        .from("templates")
        .select(`
          *,
          creator:profiles!templates_creator_id_fkey(
            id,
            username,
            full_text_name,
            avatar_url,
            is_creator,
            creator_verified
          )
        `)
        .order("created_at", {
          ascending: false,
        });

      if (templateError) {
        throw templateError;
      }

      const {
        data: reviewData,
        error: reviewError,
      } = await supabase
        .from("template_reviews")
        .select(`
          *,
          reviewer:profiles!template_reviews_reviewer_id_fkey(
            id,
            username,
            full_text_name,
            avatar_url
          )
        `)
        .order("created_at", {
          ascending: false,
        });

      if (reviewError) {
        /*
         * Review history should not prevent the
         * template dashboard from loading.
         *
         * This is useful if your review table is
         * not created yet.
         */
        console.warn(
          "Could not load template reviews:",
          reviewError.message,
        );
      }

      const normalizedTemplates =
        (templateData ?? []).map(
          normalizeTemplate,
        );

      const normalizedReviews =
        (reviewData ?? []).map(
          normalizeReview,
        );

      setTemplates(normalizedTemplates);
      setReviews(normalizedReviews);

      setSelectedTemplateId((current) => {
        if (
          current &&
          normalizedTemplates.some(
            (template) =>
              template.id === current,
          )
        ) {
          return current;
        }

        return normalizedTemplates[0]?.id ?? null;
      });
    } catch (error) {
      console.error(error);

      setNotice({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load templates.",
      });
    } finally {
      setLoading(false);
    }
  }

  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) =>
          template.id === selectedTemplateId,
      ) ?? null,
    [templates, selectedTemplateId],
  );

  const filteredTemplates = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return templates.filter((template) => {
      const creator = getCreator(
        template.creator,
      );

      const matchesStatus =
        statusFilter === "all" ||
        template.status === statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        template.title,
        template.description,
        template.category,
        creator?.username,
        creator?.full_text_name,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(normalizedSearch),
        );
    });
  }, [
    templates,
    statusFilter,
    search,
  ]);

  const pendingCount = templates.filter(
    (template) =>
      template.status === "pending",
  ).length;

  const publishedCount = templates.filter(
    (template) =>
      template.status === "published",
  ).length;

  const rejectedCount = templates.filter(
    (template) =>
      template.status === "rejected",
  ).length;

  const archivedCount = templates.filter(
    (template) =>
      template.status === "archived",
  ).length;

  const selectedReviews = useMemo(() => {
    if (!selectedTemplate) {
      return [];
    }

    return reviews
      .filter(
        (review) =>
          review.template_id ===
          selectedTemplate.id,
      )
      .sort(
        (a, b) =>
          new Date(
            b.created_at,
          ).getTime() -
          new Date(
            a.created_at,
          ).getTime(),
      );
  }, [
    reviews,
    selectedTemplate,
  ]);

  function showSuccess(
    message: string,
  ) {
    setNotice({
      type: "success",
      message,
    });

    window.setTimeout(() => {
      setNotice(null);
    }, 4000);
  }

  function showError(
    message: string,
  ) {
    setNotice({
      type: "error",
      message,
    });
  }

  function updateLocalTemplate(
    updated: Template,
  ) {
    setTemplates((current) =>
      current.map((template) =>
        template.id === updated.id
          ? {
              ...template,
              ...updated,
            }
          : template,
      ),
    );
  }

  async function approveTemplate() {
    if (!selectedTemplate) {
      return;
    }

    setBusyAction("approve");
    setNotice(null);

    try {
      const {
        data,
        error,
      } = await supabase.rpc(
        "admin_approve_template",
        {
          p_template_id:
            selectedTemplate.id,

          p_note:
            reviewNote.trim() || null,
        },
      );

      if (error) {
        throw error;
      }

      const updated = Array.isArray(data)
        ? data[0]
        : data;

      if (!updated) {
        throw new Error(
          "The template was not returned after approval.",
        );
      }

      const normalized =
        normalizeTemplate(updated);

      updateLocalTemplate(normalized);

      const newReview: Review = {
        id: crypto.randomUUID(),

        template_id:
          selectedTemplate.id,

        reviewer_id:
          adminProfile.id,

        action: "approved",

        note:
          reviewNote.trim() || null,

        previous_status:
          selectedTemplate.status,

        new_status: "published",

        created_at:
          new Date().toISOString(),

        reviewer: {
          id: adminProfile.id,

          username:
            adminProfile.username,

          full_text_name:
            adminProfile.full_text_name,

          avatar_url:
            adminProfile.avatar_url,
        },
      };

      setReviews((current) => [
        newReview,
        ...current,
      ]);

      setReviewNote("");

      showSuccess(
        `"${selectedTemplate.title}" was published.`,
      );
    } catch (error) {
      console.error(error);

      showError(
        error instanceof Error
          ? error.message
          : "Failed to approve template.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function rejectTemplate() {
    if (!selectedTemplate) {
      return;
    }

    const reason =
      rejectReason.trim();

    if (!reason) {
      showError(
        "Please provide a rejection reason.",
      );

      return;
    }

    setBusyAction("reject");
    setNotice(null);

    try {
      const {
        data,
        error,
      } = await supabase.rpc(
        "admin_reject_template",
        {
          p_template_id:
            selectedTemplate.id,

          p_reason: reason,
        },
      );

      if (error) {
        throw error;
      }

      const updated = Array.isArray(data)
        ? data[0]
        : data;

      if (!updated) {
        throw new Error(
          "The template was not returned after rejection.",
        );
      }

      const normalized =
        normalizeTemplate(updated);

      updateLocalTemplate(normalized);

      const newReview: Review = {
        id: crypto.randomUUID(),

        template_id:
          selectedTemplate.id,

        reviewer_id:
          adminProfile.id,

        action: "rejected",

        note: reason,

        previous_status:
          selectedTemplate.status,

        new_status: "rejected",

        created_at:
          new Date().toISOString(),

        reviewer: {
          id: adminProfile.id,

          username:
            adminProfile.username,

          full_text_name:
            adminProfile.full_text_name,

          avatar_url:
            adminProfile.avatar_url,
        },
      };

      setReviews((current) => [
        newReview,
        ...current,
      ]);

      setRejectReason("");

      setShowRejectDialog(false);

      showSuccess(
        `"${selectedTemplate.title}" was rejected.`,
      );
    } catch (error) {
      console.error(error);

      showError(
        error instanceof Error
          ? error.message
          : "Failed to reject template.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function archiveTemplate() {
    if (!selectedTemplate) {
      return;
    }

    setBusyAction("archive");
    setNotice(null);

    try {
      const note =
        reviewNote.trim() ||
        "Archived by administrator.";

      const {
        data,
        error,
      } = await supabase.rpc(
        "admin_archive_template",
        {
          p_template_id:
            selectedTemplate.id,

          p_note: note,
        },
      );

      if (error) {
        throw error;
      }

      const updated = Array.isArray(data)
        ? data[0]
        : data;

      if (!updated) {
        throw new Error(
          "The template was not returned after archiving.",
        );
      }

      const normalized =
        normalizeTemplate(updated);

      updateLocalTemplate(normalized);

      const newReview: Review = {
        id: crypto.randomUUID(),

        template_id:
          selectedTemplate.id,

        reviewer_id:
          adminProfile.id,

        action: "archived",

        note,

        previous_status:
          selectedTemplate.status,

        new_status: "archived",

        created_at:
          new Date().toISOString(),

        reviewer: {
          id: adminProfile.id,

          username:
            adminProfile.username,

          full_text_name:
            adminProfile.full_text_name,

          avatar_url:
            adminProfile.avatar_url,
        },
      };

      setReviews((current) => [
        newReview,
        ...current,
      ]);

      setReviewNote("");

      showSuccess(
        `"${selectedTemplate.title}" was archived.`,
      );
    } catch (error) {
      console.error(error);

      showError(
        error instanceof Error
          ? error.message
          : "Failed to archive template.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f8fc] text-slate-950">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
              <ShieldCheck size={20} />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                enotes Admin
              </p>

              <p className="truncate text-xs text-slate-500">
                Template moderation
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span>
              {adminProfile.full_text_name ||
                adminProfile.username ||
                "Administrator"}
            </span>

            <span className="h-1 w-1 rounded-full bg-slate-300" />

            <span>Administrator</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        {/* HEADING */}
        <section className="mb-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                <Sparkles size={16} />

                <span>
                  Content management
                </span>
              </div>

              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Template review
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Review creator submissions, publish
                approved templates, and keep a complete
                moderation history.
              </p>
            </div>

            <button
              type="button"
              onClick={loadTemplates}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2
                  size={16}
                  className="animate-spin"
                />
              ) : (
                <History size={16} />
              )}

              Refresh
            </button>
          </div>
        </section>

        {/* STATISTICS */}
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            type="button"
            onClick={() =>
              setStatusFilter("pending")
            }
            className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              statusFilter === "pending"
                ? "border-amber-300 ring-2 ring-amber-100"
                : "border-slate-200"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Pending
              </span>

              <Clock3
                size={17}
                className="text-amber-600"
              />
            </div>

            <p className="text-2xl font-bold">
              {pendingCount}
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter("published")
            }
            className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              statusFilter === "published"
                ? "border-emerald-300 ring-2 ring-emerald-100"
                : "border-slate-200"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Published
              </span>

              <Check
                size={17}
                className="text-emerald-600"
              />
            </div>

            <p className="text-2xl font-bold">
              {publishedCount}
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter("rejected")
            }
            className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              statusFilter === "rejected"
                ? "border-red-300 ring-2 ring-red-100"
                : "border-slate-200"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Rejected
              </span>

              <XCircle
                size={17}
                className="text-red-600"
              />
            </div>

            <p className="text-2xl font-bold">
              {rejectedCount}
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter("archived")
            }
            className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              statusFilter === "archived"
                ? "border-slate-400 ring-2 ring-slate-100"
                : "border-slate-200"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Archived
              </span>

              <Archive
                size={17}
                className="text-slate-500"
              />
            </div>

            <p className="text-2xl font-bold">
              {archivedCount}
            </p>
          </button>
        </section>

        {/* WORKSPACE */}
        <section className="grid min-h-[680px] grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(480px,1.05fr)]">
          {/* LIST */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search
                    size={17}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(
                        event.target.value,
                      )
                    }
                    placeholder="Search templates or creators..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100"
                  />
                </div>

                <div className="relative">
                  <Filter
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target
                          .value as
                          | "all"
                          | Status,
                      )
                    }
                    className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 sm:w-44"
                  >
                    {statuses.map(
                      (status) => (
                        <option
                          key={
                            status.value
                          }
                          value={
                            status.value
                          }
                        >
                          {status.label}
                        </option>
                      ),
                    )}
                  </select>

                  <ChevronDown
                    size={15}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {filteredTemplates.length}{" "}
                  template
                  {filteredTemplates.length ===
                  1
                    ? ""
                    : "s"}
                </span>

                {statusFilter ===
                  "pending" && (
                  <span className="font-medium text-amber-600">
                    Awaiting review
                  </span>
                )}
              </div>
            </div>

            <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
              {filteredTemplates.length ===
              0 ? (
                <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                    <FileVideo
                      size={24}
                      className="text-slate-400"
                    />
                  </div>

                  <h2 className="font-semibold">
                    No templates found
                  </h2>

                  <p className="mt-1 max-w-sm text-sm text-slate-500">
                    There are no templates matching
                    your current filters.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredTemplates.map(
                    (template) => {
                      const creator =
                        getCreator(
                          template.creator,
                        );

                      const isSelected =
                        selectedTemplateId ===
                        template.id;

                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() =>
                            setSelectedTemplateId(
                              template.id,
                            )
                          }
                          className={`flex w-full gap-3 p-4 text-left transition ${
                            isSelected
                              ? "bg-slate-50"
                              : "hover:bg-slate-50/70"
                          }`}
                        >
                          <div className="h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
                            {template.thumbnail_url ? (
                              <img
                                src={
                                  template.thumbnail_url
                                }
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <FileVideo
                                  size={20}
                                  className="text-slate-400"
                                />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="line-clamp-2 text-sm font-semibold">
                                {
                                  template.title
                                }
                              </h3>

                              <span
                                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClasses(
                                  template.status,
                                )}`}
                              >
                                {statusLabel(
                                  template.status,
                                )}
                              </span>
                            </div>

                            <p className="mt-1 truncate text-xs text-slate-500">
                              {creator?.full_text_name ||
                                creator?.username ||
                                "Unknown creator"}
                            </p>

                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                              <span>
                                {template.category ||
                                  "Uncategorized"}
                              </span>

                              <span>
                                {template.aspect_ratio ||
                                  "—"}
                              </span>

                              <span>
                                {formatDuration(
                                  template.duration_seconds,
                                )}
                              </span>
                            </div>

                            <p className="mt-2 text-[11px] text-slate-400">
                              Submitted{" "}
                              {formatDate(
                                template.submitted_at ||
                                  template.created_at,
                              )}
                            </p>
                          </div>
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          </div>

          {/* DETAILS */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {!selectedTemplate ? (
              <div className="flex min-h-[680px] flex-col items-center justify-center px-8 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                  <ShieldCheck
                    size={28}
                    className="text-slate-400"
                  />
                </div>

                <h2 className="text-lg font-semibold">
                  Select a template
                </h2>

                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  Choose a template from the list to
                  inspect its details and perform
                  moderation actions.
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                {/* PREVIEW */}
                <div className="relative flex min-h-[300px] items-center justify-center overflow-hidden bg-slate-950 p-5 sm:min-h-[360px]">
                  {selectedTemplate.preview_url ? (
                    <video
                      src={
                        selectedTemplate.preview_url
                      }
                      poster={
                        selectedTemplate.thumbnail_url ||
                        undefined
                      }
                      controls
                      playsInline
                      className="max-h-[380px] max-w-full rounded-xl object-contain shadow-2xl"
                    />
                  ) : selectedTemplate.thumbnail_url ? (
                    <img
                      src={
                        selectedTemplate.thumbnail_url
                      }
                      alt={
                        selectedTemplate.title
                      }
                      className="max-h-[380px] max-w-full rounded-xl object-contain shadow-2xl"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-center text-white/60">
                      <FileVideo size={40} />

                      <p className="text-sm">
                        No preview available
                      </p>
                    </div>
                  )}

                  <div className="absolute left-4 top-4">
                    <span
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur ${statusClasses(
                        selectedTemplate.status,
                      )}`}
                    >
                      {statusLabel(
                        selectedTemplate.status,
                      )}
                    </span>
                  </div>
                </div>

                {/* DETAILS */}
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-6 p-5 sm:p-6">
                    {/* TITLE */}
                    <div>
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0">
                          <h2 className="text-xl font-bold tracking-tight">
                            {
                              selectedTemplate.title
                            }
                          </h2>

                          <p className="mt-1 text-sm text-slate-500">
                            {selectedTemplate.description ||
                              "No description provided."}
                          </p>
                        </div>

                        {selectedTemplate.preview_url && (
                          <a
                            href={
                              selectedTemplate.preview_url
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <ExternalLink
                              size={14}
                            />

                            Open preview
                          </a>
                        )}
                      </div>
                    </div>

                    {/* CREATOR */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Creator
                      </p>

                      <div className="flex items-center gap-3">
                        {getCreator(
                          selectedTemplate.creator,
                        )?.avatar_url ? (
                          <img
                            src={
                              getCreator(
                                selectedTemplate.creator,
                              )?.avatar_url ||
                              ""
                            }
                            alt=""
                            className="h-11 w-11 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                            {(
                              getCreator(
                                selectedTemplate.creator,
                              )?.full_text_name ||
                              getCreator(
                                selectedTemplate.creator,
                              )?.username ||
                              "C"
                            )
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {getCreator(
                              selectedTemplate.creator,
                            )?.full_text_name ||
                              getCreator(
                                selectedTemplate.creator,
                              )?.username ||
                              "Unknown creator"}
                          </p>

                          <p className="truncate text-xs text-slate-500">
                            @
                            {getCreator(
                              selectedTemplate.creator,
                            )?.username ||
                              "unknown"}
                          </p>
                        </div>

                        {getCreator(
                          selectedTemplate.creator,
                        )?.creator_verified && (
                          <span className="ml-auto rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-600">
                            Verified
                          </span>
                        )}
                      </div>
                    </div>

                    {/* METADATA */}
                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Template information
                      </p>

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <InfoItem
                          label="Category"
                          value={
                            selectedTemplate.category ||
                            "—"
                          }
                        />

                        <InfoItem
                          label="Aspect"
                          value={
                            selectedTemplate.aspect_ratio ||
                            "—"
                          }
                        />

                        <InfoItem
                          label="Duration"
                          value={formatDuration(
                            selectedTemplate.duration_seconds,
                          )}
                        />

                        <InfoItem
                          label="Price"
                          value={formatPrice(
                            selectedTemplate.price_cents,
                            selectedTemplate.currency,
                          )}
                        />
                      </div>
                    </div>

                    {/* TAGS */}
                    {Array.isArray(
                      selectedTemplate.tags,
                    ) &&
                      selectedTemplate.tags
                        .length > 0 && (
                        <div>
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Tags
                          </p>

                          <div className="flex flex-wrap gap-2">
                            {selectedTemplate.tags.map(
                              (
                                tag,
                                index,
                              ) => (
                                <span
                                  key={`${String(
                                    tag,
                                  )}-${index}`}
                                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"
                                >
                                  {String(
                                    tag,
                                  )}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      )}

                    {/* REJECTION */}
                    {selectedTemplate.rejection_reason && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                        <div className="flex gap-3">
                          <XCircle
                            size={18}
                            className="mt-0.5 shrink-0 text-red-600"
                          />

                          <div>
                            <p className="text-sm font-semibold text-red-800">
                              Rejection reason
                            </p>

                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-red-700">
                              {
                                selectedTemplate.rejection_reason
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* REVIEW NOTE */}
                    <div>
                      <label
                        htmlFor="review-note"
                        className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400"
                      >
                        Review note
                      </label>

                      <textarea
                        id="review-note"
                        value={reviewNote}
                        onChange={(event) =>
                          setReviewNote(
                            event.target.value,
                          )
                        }
                        placeholder="Optional internal note..."
                        rows={3}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                      />
                    </div>

                    {/* HISTORY */}
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          setShowHistory(
                            (value) =>
                              !value,
                          )
                        }
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <History size={16} />

                          Review history
                        </span>

                        <ChevronDown
                          size={16}
                          className={`transition-transform ${
                            showHistory
                              ? "rotate-180"
                              : ""
                          }`}
                        />
                      </button>

                      {showHistory && (
                        <div className="mt-3 space-y-3">
                          {selectedReviews.length ===
                          0 ? (
                            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                              No review history yet.
                            </p>
                          ) : (
                            selectedReviews.map(
                              (review) => {
                                const reviewer =
                                  getReviewer(
                                    review.reviewer,
                                  );

                                return (
                                  <div
                                    key={
                                      review.id
                                    }
                                    className="relative border-l-2 border-slate-200 pl-4"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-semibold capitalize">
                                        {
                                          review.action
                                        }
                                      </span>

                                      <span className="text-xs text-slate-400">
                                        {formatDate(
                                          review.created_at,
                                        )}
                                      </span>
                                    </div>

                                    <p className="mt-1 text-xs text-slate-500">
                                      by{" "}
                                      {reviewer?.full_text_name ||
                                        reviewer?.username ||
                                        "Administrator"}
                                    </p>

                                    {review.note && (
                                      <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-600">
                                        {
                                          review.note
                                        }
                                      </p>
                                    )}

                                    <p className="mt-1 text-[11px] text-slate-400">
                                      {review.previous_status ||
                                        "—"}{" "}
                                      →{" "}
                                      {review.new_status ||
                                        "—"}
                                    </p>
                                  </div>
                                );
                              },
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ACTIONS */}
                <div className="border-t border-slate-200 bg-white p-4 sm:p-5">
                  {selectedTemplate.status ===
                    "pending" && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={
                          busyAction !==
                          null
                        }
                        onClick={() =>
                          setShowRejectDialog(
                            true,
                          )
                        }
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X size={17} />

                        Reject
                      </button>

                      <button
                        type="button"
                        disabled={
                          busyAction !==
                          null
                        }
                        onClick={
                          approveTemplate
                        }
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyAction ===
                        "approve" ? (
                          <Loader2
                            size={17}
                            className="animate-spin"
                          />
                        ) : (
                          <Check
                            size={17}
                          />
                        )}

                        Approve & publish
                      </button>
                    </div>
                  )}

                  {(selectedTemplate.status ===
                    "published" ||
                    selectedTemplate.status ===
                      "rejected") && (
                    <button
                      type="button"
                      disabled={
                        busyAction !==
                        null
                      }
                      onClick={
                        archiveTemplate
                      }
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyAction ===
                      "archive" ? (
                        <Loader2
                          size={17}
                          className="animate-spin"
                        />
                      ) : (
                        <Archive
                          size={17}
                        />
                      )}

                      Archive template
                    </button>
                  )}

                  {selectedTemplate.status ===
                    "archived" && (
                    <div className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">
                      This template is archived.
                    </div>
                  )}

                  {selectedTemplate.status ===
                    "draft" && (
                    <div className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">
                      This template has not been submitted
                      for review.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* NOTICE */}
      {notice && (
        <div className="fixed bottom-4 left-4 right-4 z-50 flex justify-center sm:left-auto sm:right-6 sm:justify-end">
          <div
            className={`max-w-md rounded-2xl border px-4 py-3 text-sm font-medium shadow-xl ${
              notice.type === "success"
                ? "border-emerald-200 bg-white text-emerald-700"
                : "border-red-200 bg-white text-red-700"
            }`}
          >
            {notice.message}
          </div>
        </div>
      )}

      {/* REJECT DIALOG */}
      {showRejectDialog &&
        selectedTemplate && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">
                    Reject template
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Explain what the creator needs to
                    change before resubmitting.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (
                      busyAction === null
                    ) {
                      setShowRejectDialog(
                        false,
                      );
                    }
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Template
                </p>

                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-semibold">
                    {
                      selectedTemplate.title
                    }
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {getCreator(
                      selectedTemplate.creator,
                    )?.full_text_name ||
                      getCreator(
                        selectedTemplate.creator,
                      )?.username ||
                      "Unknown creator"}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="rejection-reason"
                  className="mb-2 block text-sm font-semibold"
                >
                  Rejection reason
                </label>

                <textarea
                  id="rejection-reason"
                  value={rejectReason}
                  onChange={(event) =>
                    setRejectReason(
                      event.target.value,
                    )
                  }
                  placeholder="Explain what needs to be changed..."
                  rows={6}
                  autoFocus
                  className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
                />

                <p className="mt-2 text-xs text-slate-400">
                  This reason will be stored on the
                  template and included in the review
                  history.
                </p>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={
                    busyAction !== null
                  }
                  onClick={() =>
                    setShowRejectDialog(
                      false,
                    )
                  }
                  className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={
                    busyAction !== null ||
                    !rejectReason.trim()
                  }
                  onClick={
                    rejectTemplate
                  }
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction ===
                  "reject" ? (
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                  ) : (
                    <XCircle
                      size={17}
                    />
                  )}

                  Reject template
                </button>
              </div>
            </div>
          </div>
        )}
    </main>
  );
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-semibold text-slate-700">
        {value}
      </p>
    </div>
  );
}