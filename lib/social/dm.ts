import { supabase } from '@/lib/supabase/client';

/**
 * Find the 1:1 conversation between the signed-in user and another member,
 * or create it (conversation + both member rows). Returns the conversation
 * id, or null when creation failed (RLS/network) — callers surface that.
 */
export async function findOrCreateDm(myId: string, otherId: string): Promise<string | null> {
  /* reuse an existing DM with both members when one exists */
  const { data: mine } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', myId);
  const myConvIds = (mine || []).map((row: any) => row.conversation_id);

  if (myConvIds.length) {
    const { data: theirs } = await supabase
      .from('conversation_members')
      .select('conversation_id, conversations!inner(id, is_group)')
      .eq('user_id', otherId)
      .in('conversation_id', myConvIds);
    const match = (theirs || []).find((row: any) => row.conversations?.is_group === false);
    if (match) return match.conversation_id as string;
  }

  /* Create a new DM. conversations_insert_creator RLS allows the signed-in
     creator; member rows are inserted right after. */
  const { data: conv, error } = await supabase
    .from('conversations')
    .insert({ is_group: false, created_by: myId })
    .select('id')
    .single();
  if (error || !conv) return null;

  const { error: memberError } = await supabase.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: myId },
    { conversation_id: conv.id, user_id: otherId },
  ]);
  if (memberError) return null;

  return conv.id as string;
}
