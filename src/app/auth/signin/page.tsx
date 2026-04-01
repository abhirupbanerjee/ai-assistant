'use client';

import { signIn, getProviders } from 'next-auth/react';
import { useEffect, useState, Suspense, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

type Provider = {
  id: string;
  name: string;
  type: string;
};

function SignInContent() {
  const [providers, setProviders] = useState<Record<string, Provider> | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [credentialsError, setCredentialsError] = useState('');
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/chat';
  const error = searchParams.get('error');

  useEffect(() => {
    getProviders().then(setProviders);
  }, []);

  // Check if credentials provider is available
  const hasCredentials = providers && 'credentials' in providers;

  // Get OAuth providers (exclude credentials)
  const oauthProviders = providers
    ? Object.values(providers).filter((p) => p.id !== 'credentials')
    : [];

  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setCredentialsError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setCredentialsError('Invalid email or password');
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setCredentialsError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case 'azure-ad':
        return (
          <svg className="w-5 h-5 mr-3" viewBox="0 0 23 23" fill="none">
            <path d="M11 0H0V11H11V0Z" fill="#F25022" />
            <path d="M23 0H12V11H23V0Z" fill="#7FBA00" />
            <path d="M11 12H0V23H11V12Z" fill="#00A4EF" />
            <path d="M23 12H12V23H23V12Z" fill="#FFB900" />
          </svg>
        );
      case 'google':
        return (
          <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        );
      default:
        return null;
    }
  };

  const getProviderButtonStyle = (providerId: string) => {
    switch (providerId) {
      case 'azure-ad':
        return 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300';
      case 'google':
        return 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300';
      default:
        return 'bg-blue-600 hover:bg-blue-700 text-white';
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-xl mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Policy Bot</h1>
            <p className="text-gray-500 mt-2">Sign in to continue</p>
          </div>

          {/* Error Message */}
          {(error || credentialsError) && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">
                {credentialsError ||
                  (error === 'AccessDenied'
                    ? 'Access denied. Your account is not authorized to use this application.'
                    : error === 'CredentialsSignin'
                      ? 'Invalid email or password.'
                      : 'An error occurred during sign in. Please try again.')}
              </p>
            </div>
          )}

          {/* Loading state */}
          {!providers && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          {/* Credentials Form */}
          {hasCredentials && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-4 mb-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Signing in...
                  </>
                ) : (
                  'Sign in with Email'
                )}
              </button>
            </form>
          )}

          {/* Divider - only show if we have both credentials and OAuth providers */}
          {hasCredentials && oauthProviders.length > 0 && (
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-3 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>
          )}

          {/* OAuth Login Buttons */}
          {oauthProviders.length > 0 && (
            <div className="space-y-3">
              {oauthProviders.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => signIn(provider.id, { callbackUrl })}
                  className={`w-full flex items-center justify-center px-4 py-3 rounded-lg font-medium transition-all duration-200 ${getProviderButtonStyle(provider.id)}`}
                >
                  {getProviderIcon(provider.id)}
                  Continue with{' '}
                  {provider.name === 'Azure Active Directory' ? 'Microsoft' : provider.name}
                </button>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-xs text-center text-gray-400">
              By signing in, you agree to the terms of use and privacy policy.
            </p>
          </div>
        </div>

        {/* Role Info */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">Need access? Contact your administrator.</p>
          <a href="/" className="inline-block mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors">
            &larr; Back to home
          </a>
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SignInContent />
    </Suspense>
  );
}
