import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - AI Assistant',
  description: 'Privacy Policy for AI Assistant — how we collect, use, and protect your data.',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Privacy Policy</h1>
          <p className="text-sm text-gray-500 mt-1">Last updated: July 3, 2026</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg border shadow-sm p-6 sm:p-8">
          <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-gray-900">1. Introduction</h2>
              <p>
                AI Assistant (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to protecting your privacy.
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use
                our AI-powered platform for governments, ministries, and enterprises.
              </p>
              <p>
                AI Assistant is an open-source, self-hosted platform. All data remains on your organization&rsquo;s
                infrastructure. We do not sell, rent, or share your personal data with third parties for marketing purposes.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">2. Information We Collect</h2>

              <h3 className="text-base font-medium text-gray-800">2.1 Account Information</h3>
              <p>When you sign in to AI Assistant, we collect the following information depending on your authentication method:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Google OAuth:</strong> Your name, email address, and profile picture as provided by your Google account. We request only the <code>profile</code>, <code>email</code>, and <code>openid</code> scopes.</li>
                <li><strong>Azure AD (Microsoft) OAuth:</strong> Your name, email address, and profile information as provided by your Azure AD directory.</li>
                <li><strong>Email/Password Credentials:</strong> Your email address and a bcrypt-hashed password. We never store plain-text passwords.</li>
              </ul>

              <h3 className="text-base font-medium text-gray-800 mt-4">2.2 Usage Data</h3>
              <p>
                We collect information about your interactions with the platform, including:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Chat messages and conversations with the AI assistant</li>
                <li>Document uploads and generated content</li>
                <li>Feature usage and tool interactions</li>
                <li>Thread and workspace activity</li>
              </ul>

              <h3 className="text-base font-medium text-gray-800 mt-4">2.3 Technical Data</h3>
              <p>
                Our servers automatically collect standard log data including IP addresses, browser type,
                operating system, referring URLs, and timestamps. This data is used for security monitoring,
                debugging, and service improvement.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">3. How We Use Your Information</h2>
              <p>We use the collected information for the following purposes:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Authentication and Authorization:</strong> To verify your identity and determine your access level (user, superuser, admin, or super_admin).</li>
                <li><strong>Service Delivery:</strong> To provide AI-powered chat, document generation, web search, and other platform features.</li>
                <li><strong>Personalization:</strong> To maintain user memory and preferences for more relevant AI responses.</li>
                <li><strong>Security:</strong> To monitor for unauthorized access, investigate security incidents, and enforce access controls.</li>
                <li><strong>Improvement:</strong> To analyze usage patterns and improve the platform&rsquo;s performance and features.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">4. Data Storage and Retention</h2>
              <p>
                AI Assistant is a <strong>self-hosted platform</strong>. All data is stored on your organization&rsquo;s
                own infrastructure using PostgreSQL (primary database), Qdrant (vector store), and Redis (cache/sessions).
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Account data</strong> is retained for the duration of your account&rsquo;s existence.</li>
                <li><strong>Conversation data</strong> is retained until you or an administrator deletes the associated thread or workspace.</li>
                <li><strong>User memory</strong> can be viewed and cleared at any time from your Profile page.</li>
                <li><strong>Chat history</strong> can be exported and/or deleted from your Profile page.</li>
                <li><strong>Log data</strong> is retained for a reasonable period for security and debugging purposes.</li>
              </ul>
              <p>
                Administrators can configure backup schedules and data retention policies through the Admin dashboard.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">5. Data Sharing and Disclosure</h2>
              <p>
                We do <strong>not</strong> sell, rent, or trade your personal information. We may share data only in the following circumstances:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>AI/LLM Providers:</strong> Chat messages and queries are transmitted to configured LLM providers (e.g., OpenAI, Anthropic, Google) to generate AI responses. These providers process data per their own privacy policies. The platform supports air-gapped deployments with local models (Ollama) that keep all data on-premises.</li>
                <li><strong>Web Search:</strong> When you use web search features, queries are sent to the configured search API (e.g., Tavily).</li>
                <li><strong>Legal Compliance:</strong> If required by applicable law, regulation, or legal process.</li>
                <li><strong>Organizational Administrators:</strong> Your organization&rsquo;s administrators may access usage data and conversation logs within the Admin dashboard for oversight purposes.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">6. Data Security</h2>
              <p>
                We implement appropriate technical and organizational measures to protect your data:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Encryption in transit:</strong> All traffic is encrypted via TLS (HTTPS).</li>
                <li><strong>Encryption at rest:</strong> Sensitive configuration data (API keys, data source credentials) is encrypted using AES-256-GCM.</li>
                <li><strong>Password hashing:</strong> User passwords are hashed using bcrypt.</li>
                <li><strong>Role-based access control:</strong> Four-tier role system (super_admin, admin, superuser, user) with granular permissions.</li>
                <li><strong>Session security:</strong> HTTP-only, SameSite Lax session cookies with secure flag in production.</li>
                <li><strong>Container security:</strong> The application runs as a non-root user in Docker containers.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">7. Your Rights</h2>
              <p>
                Depending on your jurisdiction, you may have the following rights regarding your personal data:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Access:</strong> View your profile information, memory, and conversation history.</li>
                <li><strong>Export:</strong> Download your chat history as a ZIP of Markdown files from your Profile page.</li>
                <li><strong>Deletion:</strong> Clear your memory or delete your account (contact your administrator).</li>
                <li><strong>Correction:</strong> Update your profile information through your authentication provider.</li>
              </ul>
              <p>
                To exercise these rights, use the self-service options in your Profile page or contact your
                organization&rsquo;s AI Assistant administrator.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">8. Cookies</h2>
              <p>
                AI Assistant uses essential session cookies for authentication. These cookies are:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Session token:</strong> A secure, HTTP-only cookie used to maintain your authenticated session.</li>
                <li><strong>CSRF token:</strong> A cookie used to prevent cross-site request forgery attacks.</li>
              </ul>
              <p>
                We do not use tracking cookies, advertising cookies, or third-party analytics cookies. The platform may
                use Cloudflare Web Analytics (if configured) for privacy-preserving usage metrics that do not use cookies.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">9. Children&rsquo;s Privacy</h2>
              <p>
                AI Assistant is designed for government and enterprise use. We do not knowingly collect personal
                information from children under the age of 13. If you believe a child has provided personal data,
                please contact your organization&rsquo;s administrator.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">10. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify users of material changes
                through the platform or via email. Your continued use of AI Assistant after changes become effective
                constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">11. Contact</h2>
              <p>
                AI Assistant is an open-source platform deployed and managed by your organization.
                For privacy-related inquiries, please contact your organization&rsquo;s AI Assistant administrator
                or the platform operator at the support email configured in your deployment.
              </p>
              <p>
                For issues related to Google OAuth data access, you can also manage your connected apps at{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  className="text-blue-600 hover:text-blue-800 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Account Permissions
                </a>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
