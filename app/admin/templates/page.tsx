import { redirect } from "next/navigation";
import TemplateReviewDashboard from "./TemplateReviewDashboard";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  const supabase = await createClient();

  /*
   * Get the currently authenticated user.
   */
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/signin");
  }

  /*
   * Get the user's profile.
   *
   * Your profiles table contains is_admin according
   * to the admin system used by the dashboard.
   */
  const {
    data: adminProfile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select(
      `
        id,
        username,
        full_text_name,
        avatar_url,
        is_admin
      `,
    )
    .eq("id", user.id)
    .single();

  if (profileError || !adminProfile) {
    redirect("/");
  }

  /*
   * Never allow a non-admin to open the admin dashboard.
   */
  if (!adminProfile.is_admin) {
    redirect("/");
  }

  /*
   * Load templates.
   */
  const {
    data: templates,
    error: templatesError,
  } = await supabase
    .from("templates")
    .select(
      `
        *,
        creator:profiles!templates_creator_id_fkey(
          id,
          username,
          full_text_name,
          avatar_url,
          is_creator,
          creator_verified
        )
      `,
    )
    .order("created_at", {
      ascending: false,
    });

  if (templatesError) {
    console.error(
      "Failed to load templates:",
      templatesError,
    );
  }

  /*
   * Load review history.
   *
   * If your foreign-key name differs, remove the
   * explicit reviewer relationship and use reviewer:profiles(...)
   * according to your schema.
   */
  const {
    data: reviews,
    error: reviewsError,
  } = await supabase
    .from("template_reviews")
    .select(
      `
        *,
        reviewer:profiles!template_reviews_reviewer_id_fkey(
          id,
          username,
          full_text_name,
          avatar_url
        )
      `,
    )
    .order("created_at", {
      ascending: false,
    });

  if (reviewsError) {
    console.error(
      "Failed to load template reviews:",
      reviewsError,
    );
  }

  return (
    <TemplateReviewDashboard
      initialTemplates={
        templates ?? []
      }
      initialReviews={
        reviews ?? []
      }
      adminProfile={{
        id: adminProfile.id,
        username:
          adminProfile.username,
        full_text_name:
          adminProfile.full_text_name,
        avatar_url:
          adminProfile.avatar_url,
        is_admin:
          adminProfile.is_admin,
      }}
    />
  );
}