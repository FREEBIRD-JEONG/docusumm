interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function readConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function getSupabaseConfig(): SupabaseConfig | null {
  return readConfig();
}

export function assertSupabaseConfig(): SupabaseConfig {
  const config = readConfig();
  if (!config) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.",
    );
  }
  return config;
}
