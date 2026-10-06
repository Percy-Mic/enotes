      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  if (!open) return null;

  const start = async () => {
    if (!selected || !media.length) {
      setError('This practice assignment does not have any media yet.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const resolvedMedia = await Promise.all(
        media.map(async (item) => {
          if (item.public_url || !item.storage_path) return item;
          const signed = await supabase.storage
            .from('studio-media')
            .createSignedUrl(item.storage_path, 60 * 60 * 6);
          return signed.data?.signedUrl
            ? { ...item, public_url: signed.data.signedUrl }
            : item;
        }),
      );

      const { data: existing, error: existingError } = await supabase
        .from('practice_sessions')
        .select('id,assignment_id,attempt_number,status')
        .eq('assignment_id', selected.id)
        .eq('user_id', userId)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        onStart(selected, resolvedMedia, existing as PracticeSession);
        return;
      }

      const { data: previous, error: previousError } = await supabase
        .from('practice_sessions')
        .select('attempt_number')
        .eq('assignment_id', selected.id)
        .eq('user_id', userId)
        .order('attempt_number', { ascending: false })
        .limit(1);

      if (previousError) throw previousError;

      const nextAttempt = Number(previous?.[0]?.attempt_number || 0) + 1;
      if (selected.max_attempts && nextAttempt > selected.max_attempts) {
        throw new Error('You have reached the maximum attempts for this assignment.');
      }

      const { data: session, error: sessionError } = await supabase
        .from('practice_sessions')
        .insert({
          assignment_id: selected.id,
          user_id: userId,
          attempt_number: nextAttempt,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .select('id,assignment_id,attempt_number')
        .single();

      if (sessionError || !session) throw sessionError || new Error('Could not start the practice session.');

      onStart(selected, resolvedMedia, session as PracticeSession);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start practice mode.');
    } finally {
      setStarting(false);
    }
  };

  const duration = selected?.target_duration_seconds;
  const requirementsToShow = requirements.length ? requirements : list(selected?.requirements).map((label, i) => ({
    id: `json-${i}`,
    label,
    required: true,
  }));

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-2 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="max-h-[94dvh] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[#101010] text-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E5798F]/15 text-[#FFB6C1]">
            <Film className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#FFB6C1]">Practice Mode</p>
            <h2 className="truncate text-base font-bold">Take a real client editing brief</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Close practice mode">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid max-h-[calc(94dvh-68px)] overflow-y-auto md:grid-cols-[280px_1fr]">
          <aside className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
            <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-white/35">Available client jobs</p>
            <div className="space-y-1.5">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Loading briefs…</div>
              ) : assignments.map((assignment) => (