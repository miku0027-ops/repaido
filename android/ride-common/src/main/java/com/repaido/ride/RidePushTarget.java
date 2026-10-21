package com.repaido.ride;

import java.util.Arrays;
import java.util.Map;

/** Treat FCM data as an untrusted routing hint; ride details are fetched after login. */
public final class RidePushTarget {
    public final String id, kind, role, state, alert, recipient;
    public final long expires, version;
    private RidePushTarget(Map<String,String> data, long expires, long version) {
        id=data.get("ride_id"); kind=data.get("ride_kind"); role=data.get("ride_role");
        state=data.get("ride_state"); alert=data.get("alert_kind"); recipient=data.get("recipient_id");
        this.expires=expires; this.version=version;
    }
    public static RidePushTarget parse(Map<String,String> data, String account, long nowSeconds) {
        try {
            if (!"ride".equals(data.get("destination")) || account==null || account.isEmpty() || !account.equals(data.get("recipient_id"))) return null;
            if (!data.getOrDefault("ride_id","").matches("[a-f0-9]{64}") || !data.getOrDefault("notification_id","").matches("[a-f0-9]{64}")) return null;
            if (!Arrays.asList("bike","cab").contains(data.get("ride_kind")) || !Arrays.asList("customer","driver","cab_owner").contains(data.get("ride_role"))) return null;
            if ("bike".equals(data.get("ride_kind")) && "cab_owner".equals(data.get("ride_role"))) return null;
            if (!Arrays.asList("offered","queued","requested","accepted","reserved","on_the_way","arrived","in_progress","completion_pending","payment_due","payment_reported","balance_due","completed","cancelled","disputed").contains(data.get("ride_state"))) return null;
            if (!Arrays.asList("request","arrival","update").contains(data.get("alert_kind"))) return null;
            if ("request".equals(data.get("alert_kind")) && ("customer".equals(data.get("ride_role")) || !Arrays.asList("offered","queued","requested").contains(data.get("ride_state")))) return null;
            if ("arrival".equals(data.get("alert_kind")) && (!"customer".equals(data.get("ride_role")) || !"arrived".equals(data.get("ride_state")))) return null;
            long expiry=Long.parseLong(data.get("expires_at")),version=Long.parseLong(data.get("ride_version"));
            if (expiry<=nowSeconds || expiry>nowSeconds+900 || version<1) return null;
            return new RidePushTarget(data,expiry,version);
        } catch (RuntimeException invalid) { return null; }
    }
    public String path() {
        boolean history=state.equals("completed")||state.equals("cancelled");
        if (role.equals("customer")) return "/go?ride="+kind+(history?"&view=rides&"+(kind.equals("cab")?"ride-booking":"bike-ride"):"&"+kind+"-ride")+"="+id;
        return "/worker?mode="+role+"&tab="+(kind.equals("bike")?"bikes":"journeys")+"&"+kind+"-ride="+id+(history?"&ride-history=1":"");
    }
    public String title() {
        if (alert.equals("request")) return "New "+kind+" ride request";
        if (alert.equals("arrival")) return "Your rider is at pickup";
        if (state.equals("cancelled")) return "Ride cancelled";
        if (state.equals("completed")) return "Ride completed";
        return "Your "+kind+" ride has an update";
    }
}
