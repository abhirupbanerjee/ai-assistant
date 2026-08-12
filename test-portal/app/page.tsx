import styles from "./page.module.css";
import { getPrincipal } from "@/lib/auth/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string }>;
}) {
  const principal = await getPrincipal();
  const { authError } = await searchParams;
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Standalone integration test portal</p>
          <h1>Test workspaces and Agent Bots without coupling deployments.</h1>
          <p>
            This application is independently built and communicates with approved
            AI Assistant instances only through public HTTP contracts.
          </p>
        </div>
        <div className={styles.status} role="status">
          <strong>{principal ? `Signed in as ${principal.name ?? principal.email ?? principal.objectId}` : "Authentication required"}</strong>
          <span>
            {principal
              ? `Portal role: ${principal.role}. Authentication is independent from AI Assistant.`
              : "Use the portal-specific Microsoft Entra application to continue."}
          </span>
        </div>
        {authError ? <p className={styles.error}>Sign-in failed. Start a new authentication attempt.</p> : null}
        {principal ? (
          <form action="/auth/logout" method="post">
            <button className={styles.action} type="submit">Sign out</button>
          </form>
        ) : (
          <a className={styles.action} href="/auth/login">Sign in with Microsoft</a>
        )}
      </main>
    </div>
  );
}
