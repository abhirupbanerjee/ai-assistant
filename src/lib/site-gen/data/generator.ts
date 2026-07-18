/**
 * Sample Data Generator
 *
 * Generates contextually appropriate dummy data for each theme + page type combination.
 * Phase 7: Full context-aware generation per theme characteristics.
 */

import type { ThemeId, PageTypeId } from '../../tools/site-gen';

/** Placeholder image URL generator */
export function getPlaceholderImage(
  width: number,
  height: number,
  label: string
): string {
  const encodedLabel = encodeURIComponent(label.slice(0, 20));
  return `https://placehold.co/${width}x${height}/e2e8f0/475569?text=${encodedLabel}&font=inter`;
}

/** Theme-specific data profiles */
const THEME_PROFILES: Record<ThemeId, Record<string, string[]>> = {
  portfolio: {
    projectNames: ['Brand Identity Package', 'Mobile App Redesign', 'E-Commerce Platform', 'Portfolio Website', 'Dashboard UI'],
    skillTags: ['UI/UX Design', 'Frontend Development', 'Brand Strategy', 'Motion Design', 'Prototyping'],
    clientNames: ['Acme Corp', 'StartupXYZ', 'DesignLab', 'TechVentures'],
  },
  product: {
    featureNames: ['Real-time Analytics', 'Team Collaboration', 'Automated Workflows', 'API Integration', 'Custom Dashboards'],
    pricingTiers: ['Starter', 'Professional', 'Enterprise'],
    testimonials: ['Increased our productivity by 300%', 'Best-in-class support team', 'Seamless migration from our old tool'],
  },
  company: {
    serviceNames: ['Strategic Consulting', 'Digital Transformation', 'Cloud Solutions', 'Data Analytics', 'Cybersecurity'],
    teamRoles: ['CEO', 'CTO', 'Head of Design', 'Lead Engineer', 'Marketing Director'],
    locations: ['New York', 'London', 'Singapore', 'Berlin', 'Tokyo'],
  },
  blog: {
    categories: ['Technology', 'Design', 'Business', 'Culture', 'Tutorial'],
    authorNames: ['Alex Chen', 'Sarah Johnson', 'Marcus Williams', 'Priya Patel'],
    articleTitles: ['The Future of AI', 'Designing for Accessibility', 'Remote Work Best Practices'],
  },
  documentation: {
    endpoints: ['GET /api/users', 'POST /api/auth', 'PUT /api/projects', 'DELETE /api/sessions'],
    sections: ['Getting Started', 'Authentication', 'API Reference', 'SDK Guide', 'Troubleshooting'],
    codeLanguages: ['JavaScript', 'Python', 'Go', 'Rust', 'Java'],
  },
  dashboard: {
    metricNames: ['Total Revenue', 'Active Users', 'Conversion Rate', 'Avg. Session', 'Bounce Rate'],
    metricValues: ['$124,500', '12,340', '3.2%', '4m 32s', '24.1%'],
    statusLabels: ['Healthy', 'Warning', 'Critical', 'Offline'],
  },
  store: {
    productNames: ['Wireless Headphones', 'Smart Watch', 'Laptop Stand', 'Mechanical Keyboard', 'USB-C Hub'],
    productCategories: ['Electronics', 'Accessories', 'Home Office', 'Audio'],
    priceRange: ['$29.99', '$49.99', '$99.99', '$199.99', '$299.99'],
  },
  event: {
    sessionTopics: ['Keynote: Future of Tech', 'Workshop: Building APIs', 'Panel: AI Ethics', 'Networking Mixer'],
    speakerNames: ['Dr. Jane Smith', 'Prof. John Doe', 'Maria Garcia', 'Tom Wilson'],
    venueNames: ['Convention Center A', 'Grand Ballroom', 'Tech Hub Auditorium'],
  },
  nonprofit: {
    programNames: ['Youth Education', 'Clean Water Initiative', 'Community Health', 'Food Security Program'],
    impactStats: ['10,000+ Lives Impacted', '50+ Communities Served', '95% Program Success Rate'],
    donorTiers: ['Friend', 'Supporter', 'Advocate', 'Champion', 'Patron'],
  },
  education: {
    courseNames: ['Introduction to Python', 'Advanced Machine Learning', 'Web Development Bootcamp', 'Data Science Fundamentals'],
    instructorNames: ['Prof. Alan Turing', 'Dr. Grace Hopper', 'Ada Lovelace, PhD'],
    moduleNames: ['Getting Started', 'Core Concepts', 'Hands-on Projects', 'Final Assessment'],
  },
};

/**
 * Generate sample data for a specific theme and page type combination.
 */
export function generateSampleData(
  themeId: ThemeId,
  pageType: PageTypeId,
  siteName: string
): Record<string, unknown> {
  const profile = THEME_PROFILES[themeId] || THEME_PROFILES.company;

  switch (pageType) {
    case 'landing':
      return {
        page_title: `Welcome to ${siteName}`,
        hero_headline: `Build Amazing Things with ${siteName}`,
        hero_subtitle: 'The modern way to create, collaborate, and deliver exceptional results.',
        hero_cta_text: 'Get Started',
        hero_cta_url: '#',
        features: (profile.featureNames || profile.serviceNames || []).slice(0, 3).map(name => ({
          feature_title: name,
          feature_description: `Powerful ${name.toLowerCase()} capabilities designed for teams of all sizes.`,
          feature_icon: 'star',
        })),
        testimonials: (profile.testimonials || [
          'Absolutely transformed our workflow.',
          'The best decision we made this year.',
        ]).slice(0, 2).map(quote => ({
          quote,
          author: pickRandom(profile.teamRoles || profile.authorNames || ['User']),
          author_title: pickRandom(['CEO', 'Director', 'Manager', 'Lead']),
        })),
      };

    case 'article':
      return {
        page_title: `Getting Started with ${siteName}`,
        author: pickRandom(profile.authorNames || profile.teamRoles || ['Author']),
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        hero_image_url: getPlaceholderImage(1200, 600, 'Article Hero'),
        content: 'This is a comprehensive guide covering everything you need to know.',
        sections: [
          { heading: 'Introduction', body: 'Welcome to this comprehensive guide...' },
          { heading: 'Key Concepts', body: 'Before diving in, let us cover the fundamentals...' },
          { heading: 'Getting Started', body: 'Follow these steps to begin your journey...' },
        ],
      };

    case 'gallery':
      return {
        page_title: `${siteName} Gallery`,
        page_description: 'Browse our collection of featured works and projects.',
        filters: (profile.productCategories || profile.categories || []).slice(0, 4).map(cat => ({
          filter_id: cat.toLowerCase().replace(/\s+/g, '-'),
          filter_label: cat,
        })),
        items: Array.from({ length: 8 }, (_, i) => ({
          image_url: getPlaceholderImage(400, 300, `Image ${i + 1}`),
          image_alt: `Gallery image ${i + 1}`,
          item_title: pickRandom(profile.projectNames || profile.productNames || [`Item ${i + 1}`]),
          item_description: `A stunning ${(profile.projectNames || ['project'])[0]} showcasing creative excellence.`,
          category: pickRandom(profile.productCategories || profile.categories || ['All']),
        })),
      };

    case 'form':
      return {
        page_title: 'Contact Us',
        page_description: 'We\'d love to hear from you. Send us a message and we\'ll respond as soon as possible.',
        fields: [
          { label: 'Full Name', name: 'name', type: 'text', required: true, placeholder: 'Enter your name' },
          { label: 'Email Address', name: 'email', type: 'email', required: true, placeholder: 'you@example.com' },
          { label: 'Subject', name: 'subject', type: 'text', required: true, placeholder: 'What is this about?' },
          { label: 'Message', name: 'message', type: 'textarea', required: true, placeholder: 'Your message...' },
        ],
        submit_label: 'Send Message',
        success_message: 'Thank you! Your message has been sent.',
      };

    case 'list-grid':
      return {
        page_title: `${siteName} Directory`,
        items: (profile.productNames || profile.serviceNames || []).slice(0, 6).map((name, i) => ({
          title: name,
          description: `Learn more about ${name.toLowerCase()} and how it can help your organization.`,
          image_url: getPlaceholderImage(300, 200, name.slice(0, 10)),
          category: pickRandom(profile.productCategories || profile.categories || ['General']),
          url: `#${name.toLowerCase().replace(/\s+/g, '-')}`,
        })),
        categories: profile.productCategories || profile.categories || [],
      };

    case 'detail':
      return {
        page_title: pickRandom(profile.productNames || profile.projectNames || ['Item Detail']),
        header_image_url: getPlaceholderImage(1200, 400, 'Detail'),
        metadata: [
          { label: 'Category', value: pickRandom(profile.productCategories || profile.categories || ['General']) },
          { label: 'Date', value: new Date().toLocaleDateString() },
          { label: 'Author', value: pickRandom(profile.authorNames || profile.teamRoles || ['Team']) },
        ],
        description: 'A comprehensive overview of this item, covering all key aspects and details.',
        related_items: (profile.productNames || profile.serviceNames || []).slice(0, 3).map(name => ({
          title: name,
          url: `#${name.toLowerCase().replace(/\s+/g, '-')}`,
        })),
      };

    case 'faq':
      return {
        page_title: 'Frequently Asked Questions',
        categories: [
          {
            category_name: 'General',
            questions: [
              { question: 'What is this service?', answer: 'This is a comprehensive platform designed to help you achieve your goals efficiently.' },
              { question: 'How do I get started?', answer: 'Simply sign up for an account and follow the onboarding guide.' },
              { question: 'Is there a free trial?', answer: 'Yes, we offer a 14-day free trial with full access to all features.' },
            ],
          },
          {
            category_name: 'Pricing',
            questions: [
              { question: 'What payment methods do you accept?', answer: 'We accept all major credit cards, PayPal, and bank transfers.' },
              { question: 'Can I upgrade my plan?', answer: 'Yes, you can upgrade or downgrade your plan at any time.' },
            ],
          },
        ],
      };

    case 'timeline':
      return {
        page_title: `${siteName} Timeline`,
        events: [
          { date: '2024 Q1', title: 'Company Founded', description: 'The beginning of our journey to transform the industry.' },
          { date: '2024 Q3', title: 'First Major Release', description: 'Launched our flagship product to early adopters.' },
          { date: '2025 Q1', title: 'Series A Funding', description: 'Secured $10M in funding to accelerate growth.' },
          { date: '2025 Q3', title: 'Global Expansion', description: 'Opened offices in three new countries.' },
          { date: '2026 Q1', title: 'Industry Recognition', description: 'Named a leader in our category by major analysts.' },
        ],
      };

    case 'comparison':
      return {
        page_title: 'Compare Options',
        columns: [
          { name: 'Basic', description: 'For individuals getting started' },
          { name: 'Pro', description: 'For growing teams' },
          { name: 'Enterprise', description: 'For large organizations' },
        ],
        rows: [
          { feature: 'Users', values: ['1', '10', 'Unlimited'] },
          { feature: 'Storage', values: ['5 GB', '100 GB', '1 TB'] },
          { feature: 'Support', values: ['Email', 'Priority', 'Dedicated'] },
          { feature: 'API Access', values: ['No', 'Yes', 'Yes'] },
          { feature: 'Custom Integrations', values: ['No', 'No', 'Yes'] },
        ],
        verdict: 'For most teams, the Pro plan offers the best balance of features and value.',
      };

    case 'data-table':
      return {
        page_title: `${siteName} Data`,
        columns: [
          { key: 'name', label: 'Name', sortable: true },
          { key: 'category', label: 'Category', sortable: true },
          { key: 'status', label: 'Status', sortable: true },
          { key: 'date', label: 'Date', sortable: true },
        ],
        rows: Array.from({ length: 10 }, (_, i) => ({
          name: pickRandom(profile.productNames || profile.serviceNames || [`Item ${i + 1}`]),
          category: pickRandom(profile.productCategories || profile.categories || ['General']),
          status: pickRandom(['Active', 'Pending', 'Completed', 'Draft']),
          date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
        })),
      };

    default:
      return {
        page_title: `${siteName} - ${pageType}`,
        page_description: `This is the ${pageType} page for ${siteName}.`,
      };
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
