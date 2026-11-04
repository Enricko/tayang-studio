//! Paid plans. Checkout and status go to the Tayang API with the stored sign-in token, which
//! stays in Rust: the webview only ever sees the payment link and the plan state.

use crate::styles_sync::endpoint;
use crate::types::{BillingError, BillingStatus, Checkout};

/// The plans for sale (shared `PAID_PLAN_IDS`).
pub const PAID_PLANS: [&str; 3] = ["lite", "creator", "pro"];

/// Only SumoPod's payment pages may be opened from what the API says: https on
/// `pay.sumopod.com`, `sumopod.com` or a `*.pymnt.global` host.
pub fn is_payment_link(u: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(u.trim()) else { return false };
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https" && (host == "pay.sumopod.com" || host == "sumopod.com" || host.ends_with(".pymnt.global"))
}

async fn send(req: reqwest::RequestBuilder) -> Result<(u16, Vec<u8>), BillingError> {
    let res = req.send().await.map_err(|_| BillingError::Network)?;
    let status = res.status().as_u16();
    let body = res.bytes().await.map_err(|_| BillingError::Network)?;
    Ok((status, body.to_vec()))
}

fn error_for(status: u16) -> BillingError {
    match status {
        401 => BillingError::SignedOut,
        400 => BillingError::InvalidPlan,
        409 => BillingError::DowngradeNotAllowed,
        429 => BillingError::RateLimited,
        503 => BillingError::Unavailable,
        502 => BillingError::PaymentProvider,
        _ => BillingError::Server,
    }
}

/// `POST /v1/billing/checkout { plan }`. Never asks for a plan that isn't for sale.
pub async fn checkout(client: &reqwest::Client, base: &str, token: &str, plan: &str) -> Result<Checkout, BillingError> {
    if !PAID_PLANS.contains(&plan) {
        return Err(BillingError::InvalidPlan);
    }
    let req = client
        .post(endpoint(base, "/v1/billing/checkout"))
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::json!({ "plan": plan }).to_string());
    match send(req).await? {
        (200..=299, body) => {
            let c = serde_json::from_slice::<Checkout>(&body).ok().filter(|c| !c.order_id.is_empty()).ok_or(BillingError::Server)?;
            if is_payment_link(&c.payment_link_url) {
                Ok(c)
            } else {
                Err(BillingError::BadLink)
            }
        }
        (status, _) => Err(error_for(status)),
    }
}

/// `GET /v1/billing/status`. A pending payment whose link isn't a SumoPod page is dropped.
pub async fn status(client: &reqwest::Client, base: &str, token: &str) -> Result<BillingStatus, BillingError> {
    match send(client.get(endpoint(base, "/v1/billing/status")).bearer_auth(token)).await? {
        (200..=299, body) => {
            let mut s = serde_json::from_slice::<BillingStatus>(&body).map_err(|_| BillingError::Server)?;
            s.pending = s.pending.filter(|p| is_payment_link(&p.payment_link_url));
            Ok(s)
        }
        (status, _) => Err(match error_for(status) {
            BillingError::InvalidPlan => BillingError::Server,
            e => e,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::http_client;
    use crate::auth::tests::{dead_base, fake};

    const CHECKOUT: &str = r#"{"orderId":"TYG-ABCDEFGH-1793793600","paymentLinkUrl":"https://pay.sumopod.com/p/1","expiresAt":"2026-11-04T13:00:00.000Z","amount":50000}"#;
    const STATUS: &str = r#"{"plan":"creator","lastPlan":"creator","currentPeriodEnd":"2026-12-04T12:00:00.000Z","active":true,"pending":{"orderId":"TYG-X","plan":"pro","paymentLinkUrl":"https://checkout.pymnt.global/p/2","expiresAt":"2026-11-04T13:00:00.000Z"},"lastPaidOrderId":"TYG-OLD"}"#;

    #[tokio::test]
    async fn checkout_posts_the_plan_with_the_token() {
        let f = fake(|r, _| match r.path.as_str() {
            "/api/v1/billing/checkout" => (200, CHECKOUT.into()),
            _ => (404, "{}".into()),
        })
        .await;
        let c = checkout(&http_client().unwrap(), &f.base, "tyg_abc", "creator").await.unwrap();
        assert_eq!((c.order_id.as_str(), c.payment_link_url.as_str(), c.amount), ("TYG-ABCDEFGH-1793793600", "https://pay.sumopod.com/p/1", 50000));
        let hits = f.hits("/api/v1/billing/checkout");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].method, "POST");
        assert_eq!(hits[0].auth.as_deref(), Some("Bearer tyg_abc"));
        assert_eq!(serde_json::from_str::<serde_json::Value>(&hits[0].body).unwrap(), serde_json::json!({ "plan": "creator" }));
    }

    #[test]
    fn only_sumopod_payment_pages_may_open() {
        for ok in ["https://pay.sumopod.com/p/1", "https://sumopod.com/pay/1", "https://checkout.pymnt.global/x", "https://PAY.SUMOPOD.COM/p"] {
            assert!(is_payment_link(ok), "{ok}");
        }
        for bad in [
            "http://pay.sumopod.com/p/1",
            "https://pay.example/p/1",
            "https://evil-sumopod.com/p",
            "https://sumopod.com.evil.net/p",
            "https://api-pay-sandbox.sumopod.com/p",
            "https://pymnt.global/p",
            "https://xpymnt.global/p",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "not a url",
        ] {
            assert!(!is_payment_link(bad), "{bad}");
        }
    }

    #[tokio::test]
    async fn checkout_refuses_a_link_off_the_payment_hosts() {
        let f = fake(|_, _| (200, CHECKOUT.replace("https://pay.sumopod.com/p/1", "https://pay.example/p/1"))).await;
        assert_eq!(checkout(&http_client().unwrap(), &f.base, "tyg_abc", "lite").await, Err(BillingError::BadLink));
        assert_eq!(serde_json::to_value(BillingError::BadLink).unwrap(), "bad_link");
        assert_eq!(serde_json::to_value(BillingError::DowngradeNotAllowed).unwrap(), "downgrade_not_allowed");
    }

    #[tokio::test]
    async fn checkout_refuses_an_unknown_plan_without_asking() {
        let f = fake(|_, _| (200, CHECKOUT.into())).await;
        for plan in ["free", "gold", ""] {
            assert_eq!(checkout(&http_client().unwrap(), &f.base, "tyg_abc", plan).await, Err(BillingError::InvalidPlan));
        }
        assert!(f.hits.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn checkout_errors_map_to_codes() {
        for (status, body, want) in [
            (401, "{}", BillingError::SignedOut),
            (502, r#"{"error":"payment_provider"}"#, BillingError::PaymentProvider),
            (500, "{}", BillingError::Server),
            (200, "nope", BillingError::Server),
            (200, r#"{"orderId":"x","paymentLinkUrl":"file:///etc/passwd","expiresAt":"x","amount":1}"#, BillingError::BadLink),
            (503, r#"{"error":"billing_unavailable"}"#, BillingError::Unavailable),
            (429, r#"{"error":"rate_limited"}"#, BillingError::RateLimited),
            (409, r#"{"error":"downgrade_not_allowed"}"#, BillingError::DowngradeNotAllowed),
        ] {
            let f = fake(move |_, _| (status, body.into())).await;
            assert_eq!(checkout(&http_client().unwrap(), &f.base, "tyg_abc", "lite").await, Err(want), "{status} {body}");
        }
        assert_eq!(checkout(&http_client().unwrap(), &dead_base().await, "tyg_abc", "lite").await, Err(BillingError::Network));
    }

    #[tokio::test]
    async fn status_reads_the_plan_and_pending_payment() {
        let f = fake(|r, _| match (r.path.as_str(), r.auth.as_deref()) {
            ("/api/v1/billing/status", Some("Bearer tyg_abc")) => (200, STATUS.into()),
            _ => (401, "{}".into()),
        })
        .await;
        let s = status(&http_client().unwrap(), &f.base, "tyg_abc").await.unwrap();
        assert_eq!((s.plan.as_str(), s.active, s.current_period_end.as_deref()), ("creator", true, Some("2026-12-04T12:00:00.000Z")));
        assert_eq!(s.last_plan.as_deref(), Some("creator"));
        assert_eq!(s.last_paid_order_id.as_deref(), Some("TYG-OLD"));
        assert_eq!(s.pending.map(|p| p.order_id), Some("TYG-X".into()));
        assert_eq!(status(&http_client().unwrap(), &f.base, "tyg_other").await, Err(BillingError::SignedOut));
    }

    #[tokio::test]
    async fn status_drops_a_pending_link_that_is_not_a_web_page() {
        let f = fake(|_, _| (200, STATUS.replace("https://checkout.pymnt.global/p/2", "javascript:alert(1)"))).await;
        let s = status(&http_client().unwrap(), &f.base, "tyg_abc").await.unwrap();
        assert!(s.pending.is_none());
        let free = fake(|_, _| (200, r#"{"plan":"free","currentPeriodEnd":null,"active":false,"pending":null}"#.into())).await;
        let s = status(&http_client().unwrap(), &free.base, "tyg_abc").await.unwrap();
        assert_eq!((s.plan.as_str(), s.active, s.current_period_end, s.pending), ("free", false, None, None));
    }

    #[tokio::test]
    async fn status_errors_map_to_codes() {
        for (st, want) in [(500, BillingError::Server), (400, BillingError::Server), (502, BillingError::PaymentProvider), (503, BillingError::Unavailable)] {
            let f = fake(move |_, _| (st, "{}".into())).await;
            assert_eq!(status(&http_client().unwrap(), &f.base, "t").await, Err(want));
        }
        assert_eq!(status(&http_client().unwrap(), &dead_base().await, "t").await, Err(BillingError::Network));
    }
}
