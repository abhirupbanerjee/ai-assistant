import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Policy Bot',
  description: 'Terms of Service for Policy Bot — conditions governing the use of our AI-powered platform.',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Terms of Service</h1>
          <p className="text-sm text-gray-500 mt-1">Last updated: July 3, 2026</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg border shadow-sm p-6 sm:p-8">
          <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-gray-900">1. Acceptance of Terms</h2>
              <p>
                By accessing or using Policy Bot (&ldquo;the Service&rdquo;), you agree to be bound by these Terms of
                Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, you may not access or use the Service.
              </p>
              <p>
                Policy Bot is an open-source AI platform licensed under the{' '}
                <a
                  href="https://polyformproject.org/licenses/noncommercial/1.0.0/"
                  className="text-blue-600 hover:text-blue-800 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Polyform NonCommercial License 1.0.0
                </a>. Commercial use requires a separate license from the rights holder.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">2. Service Description</h2>
              <p>
                Policy Bot is an AI-powered platform that provides the following capabilities to government,
                ministry, and enterprise users:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Retrieval-Augmented Generation (RAG) chat over organizational documents</li>
                <li>Multi-provider LLM support with configurable routing</li>
                <li>Document generation (PDF, DOCX, PPTX, XLSX, HTML, Markdown)</li>
                <li>Diagram, chart, and infographic generation</li>
                <li>Web search and research capabilities</li>
                <li>Autonomous agent task execution</li>
                <li>Agent Bot API for programmatic access</li>
                <li>Embeddable workspace chatbots</li>
                <li>And other features as described in the platform documentation</li>
              </ul>
              <p>
                The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We reserve the
                right to modify, suspend, or discontinue any aspect of the Service at any time.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">3. User Accounts and Authentication</h2>
              <p>
                To access the Service, you must authenticate using one of the supported methods:
                Google OAuth, Microsoft Azure AD, or email/password credentials. You are responsible for:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Maintaining the confidentiality of your authentication credentials.</li>
                <li>All activities that occur under your account.</li>
                <li>Notifying your organization&rsquo;s administrator immediately of any unauthorized use.</li>
              </ul>
              <p>
                Access to the Service is controlled by your organization&rsquo;s administrators through
                role-based access control. Your level of access (user, superuser, admin, or super_admin)
                determines which features and data are available to you.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">4. Acceptable Use</h2>
              <p>You agree not to use the Service to:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Violate any applicable laws, regulations, or governmental orders.</li>
                <li>Infringe upon the intellectual property or privacy rights of others.</li>
                <li>Generate or distribute harmful, misleading, or deceptive content.</li>
                <li>Conduct unauthorized security testing, scraping, or denial-of-service attacks.</li>
                <li>Upload malicious code, malware, or content designed to disrupt the Service.</li>
                <li>Attempt to bypass authentication, authorization, or rate-limiting mechanisms.</li>
                <li>Use the Service for any illegal activity, including fraud, harassment, or discrimination.</li>
              </ul>
              <p>
                Your organization&rsquo;s administrators may establish additional acceptable use policies.
                Violation of these Terms may result in suspension or termination of your access.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">5. AI-Generated Content</h2>
              <p>
                The Service uses large language models (LLMs) and other AI technologies to generate responses,
                documents, images, and other content. You acknowledge that:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>AI-generated content may contain errors, inaccuracies, or biases.</li>
                <li>AI-generated content should be reviewed by qualified personnel before use in decision-making.</li>
                <li>The Service does not guarantee the accuracy, completeness, or appropriateness of AI-generated content.</li>
                <li>You are responsible for validating and approving any AI-generated content before use or distribution.</li>
                <li>Third-party AI providers (e.g., OpenAI, Anthropic, Google) may have their own terms governing the use of their models.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">6. Intellectual Property</h2>
              <p>
                The Policy Bot software is open-source and licensed under the Polyform NonCommercial License 1.0.0.
                This means:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>You may use, modify, and distribute the software for non-commercial purposes.</li>
                <li>Commercial use requires a separate commercial license.</li>
                <li>All trademarks, logos, and brand features remain the property of their respective owners.</li>
              </ul>
              <p>
                Content you upload to the Service (documents, data, conversations) remains your property.
                By uploading content, you grant the Service the necessary rights to process, index, and
                analyze that content solely for the purpose of providing the Service to you.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">7. Third-Party Services</h2>
              <p>
                The Service integrates with third-party services and APIs, including but not limited to:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>LLM Providers:</strong> OpenAI, Anthropic, Google (Gemini), Mistral, DeepSeek, and others.</li>
                <li><strong>Search APIs:</strong> Tavily and other configured search providers.</li>
                <li><strong>Authentication Providers:</strong> Google OAuth, Microsoft Azure AD.</li>
                <li><strong>Email Services:</strong> SendGrid and other configured email providers.</li>
              </ul>
              <p>
                Use of these third-party services is subject to their respective terms of service and privacy policies.
                We are not responsible for the availability, accuracy, or practices of third-party services.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">8. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by applicable law:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>The Service is provided &ldquo;as is&rdquo; without warranties of any kind, either express or implied.</li>
                <li>We shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.</li>
                <li>We shall not be liable for any damages resulting from errors, inaccuracies, or omissions in AI-generated content.</li>
                <li>Our total liability for any claim arising from these Terms shall not exceed the amount paid by you (if any) for the Service in the twelve months preceding the claim.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">9. Data Sovereignty and Privacy</h2>
              <p>
                Policy Bot is a self-hosted platform. All data is stored on your organization&rsquo;s infrastructure.
                By using the Service, you acknowledge that:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your organization is the data controller for all data stored in the platform.</li>
                <li>Your use of data processed through the Service must comply with applicable data protection laws.</li>
                <li>Chat and query data sent to third-party LLM providers is subject to those providers&rsquo; data handling practices.</li>
              </ul>
              <p>
                Please review our{' '}
                <a href="/privacy-policy" className="text-blue-600 hover:text-blue-800 underline">
                  Privacy Policy
                </a>{' '}
                for detailed information on how we handle personal data.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">10. Termination</h2>
              <p>
                We reserve the right to suspend or terminate your access to the Service at any time, with or
                without cause, including but not limited to violation of these Terms. Upon termination:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your right to access the Service will immediately cease.</li>
                <li>Your data may be retained in accordance with our Privacy Policy and your organization&rsquo;s data retention policies.</li>
                <li>Provisions that by their nature should survive termination (including limitation of liability and intellectual property) will continue to apply.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">11. Changes to Terms</h2>
              <p>
                We may modify these Terms at any time. We will notify users of material changes through the
                Service or via email. Your continued use of the Service after changes become effective
                constitutes acceptance of the modified Terms. If you do not agree to the modified Terms,
                you must discontinue use of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">12. Governing Law</h2>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the jurisdiction
                in which your organization&rsquo;s Policy Bot deployment is operated, without regard to conflict
                of law principles.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">13. Contact</h2>
              <p>
                For questions about these Terms of Service, please contact your organization&rsquo;s Policy Bot
                administrator or the platform operator at the support email configured in your deployment.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
