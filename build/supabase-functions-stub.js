// Build-time stub for @supabase/functions-js. See supabase-storage-stub.js for
// the rationale; this package is imported statically by supabase-js even though
// `functions` is a lazy getter, so it ships to every visitor.
//
// CLAUDE.md records the backend as "Supabase (auth, Postgres, realtime). No
// edge functions." — nothing in src/ or shared/ reads `supabase.functions`.

const MESSAGE =
  'Supabase Edge Functions are stubbed out of this bundle (see build/supabase-functions-stub.js). ' +
  'To use supabase.functions, remove the alias in vite.config.js first.'

export const FunctionRegion = Object.freeze({
  Any: 'any',
  ApNortheast1: 'ap-northeast-1',
  ApNortheast2: 'ap-northeast-2',
  ApSouth1: 'ap-south-1',
  ApSoutheast1: 'ap-southeast-1',
  ApSoutheast2: 'ap-southeast-2',
  CaCentral1: 'ca-central-1',
  EuCentral1: 'eu-central-1',
  EuWest1: 'eu-west-1',
  EuWest2: 'eu-west-2',
  EuWest3: 'eu-west-3',
  SaEast1: 'sa-east-1',
  UsEast1: 'us-east-1',
  UsWest1: 'us-west-1',
  UsWest2: 'us-west-2',
})

export class FunctionsError extends Error {
  constructor(message, name = 'FunctionsError', context) {
    super(message)
    this.name = name
    this.context = context
  }
}

export class FunctionsFetchError extends FunctionsError {
  constructor(context) { super('Failed to send a request to the Edge Function', 'FunctionsFetchError', context) }
}

export class FunctionsRelayError extends FunctionsError {
  constructor(context) { super('Relay Error invoking the Edge Function', 'FunctionsRelayError', context) }
}

export class FunctionsHttpError extends FunctionsError {
  constructor(context) { super('Edge Function returned a non-2xx status code', 'FunctionsHttpError', context) }
}

export class FunctionsClient {
  constructor() {}

  setAuth() { throw new Error(MESSAGE) }
  invoke() { throw new Error(MESSAGE) }
}
