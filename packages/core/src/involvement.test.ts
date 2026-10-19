import { describe, expect, it } from 'vitest';
import {
  involvementListingInputSchema,
  involvementSubmissionInputSchema,
  linkHost,
  listingsForDimension,
} from './involvement.js';

const submission = {
  kind: 'listing',
  dimension_slug: 'housing',
  org_name: 'Tenant Union of Flatbush',
  about: 'A volunteer tenant union for rent-stabilized buildings.',
  pitch: 'Members learn their rights and organize building by building.',
  website: '',
  contact_name: 'Ana Ruiz',
  email: 'ana@example.org',
  phone: '',
};

describe('getting involved', () => {
  it('accepts an organization and stores empty optional fields as null', () => {
    const v = involvementSubmissionInputSchema.parse(submission);
    expect(v.website).toBeNull();
    expect(v.phone).toBeNull();
    expect(v.dimension_slug).toBe('housing');
  });

  it('requires an organization to say who it is, but not a suggestion', () => {
    const org = involvementSubmissionInputSchema.safeParse({ ...submission, org_name: '', about: ' ' });
    expect(org.success).toBe(false);
    expect(org.error!.issues.map((i) => i.path[0]).sort()).toEqual(['about', 'org_name']);
    const idea = involvementSubmissionInputSchema.safeParse({ ...submission, kind: 'suggestion', org_name: '', about: '' });
    expect(idea.success).toBe(true);
  });

  it('refuses unknown dimensions, bad emails, and non-web websites', () => {
    expect(involvementSubmissionInputSchema.safeParse({ ...submission, dimension_slug: 'mars' }).success).toBe(false);
    expect(involvementSubmissionInputSchema.safeParse({ ...submission, email: 'not-an-email' }).success).toBe(false);
    expect(involvementSubmissionInputSchema.safeParse({ ...submission, website: 'javascript:alert(1)' }).success).toBe(false);
    // An organization's own site may still be http; staff convert it before it goes public.
    expect(involvementSubmissionInputSchema.parse({ ...submission, website: 'http://tuf.example.org' }).website).toBe('http://tuf.example.org');
  });

  it('only lets https links into a listing, and each dimension once', () => {
    const base = { name: 'NYC Service', description: 'Find volunteer projects.', kind: 'volunteer' };
    expect(involvementListingInputSchema.safeParse({ ...base, url: 'http://example.org' }).success).toBe(false);
    expect(involvementListingInputSchema.safeParse({ ...base, dimension_slugs: ['food', 'food'] }).success).toBe(false);
    expect(involvementListingInputSchema.parse({ ...base, url: '', phone: '311' })).toMatchObject({ url: null, phone: '311', dimension_slugs: [] });
  });

  it('puts a dimension’s own listings before the general ones', () => {
    const l = (name: string, dimension_slugs: string[], display_order = 0) => ({ name, dimension_slugs, display_order });
    const ordered = listingsForDimension(
      [l('General B', []), l('Food only', ['food']), l('Housing', ['housing']), l('General A', []), l('Food first', ['food'], -1)],
      'food',
    );
    expect(ordered.map((x) => x.name)).toEqual(['Food first', 'Food only', 'General A', 'General B']);
  });

  it('names the host of a link for staff review', () => {
    expect(linkHost('https://www.nycservice.org/opportunities')).toBe('nycservice.org');
    expect(linkHost('nonsense')).toBeNull();
  });
});
