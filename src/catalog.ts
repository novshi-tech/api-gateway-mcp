import type { OAuth2Auth, ServiceConfig, Services } from "./config";

// Services every deployment can offer. SERVICES adds to these and overrides one by
// using its name. An OAuth service is offered only once its client's
// OAUTH_<CLIENT>_CLIENT_ID / _CLIENT_SECRET are set (see README).

function google(display_name: string, base_url: string, scope: string): ServiceConfig {
  const auth: OAuth2Auth = {
    type: "oauth2",
    client: "google",
    authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    scope,
    // A refresh token is issued only with offline access, and again only with consent.
    authorize_params: { access_type: "offline", prompt: "consent" },
  };
  return { display_name, provider: "Google", base_url, auth };
}

const GRAPH_SCOPE = [
  "offline_access",
  "User.Read",
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
  "Chat.ReadWrite",
  "ChannelMessage.Send",
  "ChannelMessage.Read.All",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
].join(" ");

export function catalog(env: Env): Services {
  const services: Services = {
    freee: {
      provider: "freee",
      base_url: "https://api.freee.co.jp",
      auth: {
        type: "oauth2",
        client: "freee",
        authorization_url: "https://accounts.secure.freee.co.jp/public_api/authorize",
        token_url: "https://accounts.secure.freee.co.jp/public_api/token",
      },
    },
    gmail: google("Gmail", "https://gmail.googleapis.com", "https://www.googleapis.com/auth/gmail.modify"),
    drive: google("Google Drive", "https://www.googleapis.com", "https://www.googleapis.com/auth/drive"),
    calendar: google(
      "Google Calendar",
      "https://www.googleapis.com",
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy",
    ),
    docs: google("Google Docs", "https://docs.googleapis.com", "https://www.googleapis.com/auth/documents"),
    analytics: google("Google Analytics (Data API)", "https://analyticsdata.googleapis.com", "https://www.googleapis.com/auth/analytics.readonly"),
    "analytics-admin": google(
      "Google Analytics (Admin API)",
      "https://analyticsadmin.googleapis.com",
      "https://www.googleapis.com/auth/analytics.readonly",
    ),
    board: {
      display_name: "board",
      base_url: "https://api.the-board.jp",
      auth: {
        type: "headers",
        headers: [
          { name: "x-api-key", label: "board の API キー" },
          { name: "authorization", label: "board の API トークン", prefix: "Bearer " },
        ],
      },
    },
    gbizinfo: {
      display_name: "gBizINFO",
      base_url: "https://api.info.gbiz.go.jp",
      auth: { type: "headers", headers: [{ name: "X-hojinInfo-api-token", label: "gBizINFO の API トークン" }] },
    },
    serper: {
      display_name: "Serper",
      base_url: "https://google.serper.dev",
      auth: { type: "headers", headers: [{ name: "X-API-KEY", label: "Serper の API キー" }] },
    },
  };
  // Graph's sign-in URLs name the Entra tenant, so it is offered only once that is set.
  const tenant: string | undefined = env.MICROSOFT_TENANT_ID;
  if (tenant) {
    services.graph = {
      display_name: "Microsoft Graph",
      provider: "Microsoft",
      base_url: "https://graph.microsoft.com",
      auth: {
        type: "oauth2",
        client: "microsoft",
        authorization_url: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
        token_url: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
        scope: GRAPH_SCOPE,
      },
    };
  }
  return services;
}
