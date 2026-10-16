'use server';

import { headers } from 'next/headers';
import { action } from './action-result';
import { clientAddress } from './client-address';
import { recordTranslationRequest, type TranslationRequestResult } from './translation-requests';

/** "Request a translation" (SPEC-v7 §3.5); the rules live in lib/translation-requests.ts. */
export const requestTranslation = action(
  async (input: { tenantSlug: string; locale: string; path: string }): Promise<TranslationRequestResult> =>
    recordTranslationRequest({ ...input, address: clientAddress(await headers()) }),
);
