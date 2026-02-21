import { LoginForm } from "@/app/login/login-form";
import { sanitizeNextPath } from "@/lib/auth/next-path";

function mapErrorMessage(errorCode: string | null | undefined): string | null {
  if (!errorCode) {
    return null;
  }

  const map: Record<string, string> = {
    missing_code: "로그인 콜백 코드가 누락되었습니다. 다시 시도해 주세요.",
    oauth_failed: "소셜 로그인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    sign_in_failed: "로그인 요청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };

  return map[errorCode] ?? "로그인 중 오류가 발생했습니다.";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(params.next);
  const callbackError = mapErrorMessage(params.error);

  return <LoginForm nextPath={nextPath} callbackError={callbackError} />;
}
