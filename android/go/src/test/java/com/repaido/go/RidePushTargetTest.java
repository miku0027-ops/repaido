package com.repaido.go;
import com.repaido.ride.RidePushTarget;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;

public class RidePushTargetTest {
    private Map<String,String> payload(){Map<String,String> p=new HashMap<>();p.put("destination","ride");p.put("ride_id","a".repeat(64));p.put("notification_id","b".repeat(64));p.put("recipient_id","member");p.put("ride_kind","bike");p.put("ride_role","driver");p.put("ride_state","offered");p.put("ride_version","2");p.put("alert_kind","request");p.put("expires_at","1200");return p;}
    @Test public void offeredBikeOpensDriverRequestWithoutAnAction(){RidePushTarget r=RidePushTarget.parse(payload(),"member",1000);assertNotNull(r);assertEquals("/worker?mode=driver&tab=bikes&bike-ride="+"a".repeat(64),r.path());}
    @Test public void wrongAccountExpiryAndArbitraryUrlsAreRejected(){assertNull(RidePushTarget.parse(payload(),"other",1000));assertNull(RidePushTarget.parse(payload(),"member",1200));Map<String,String> p=payload();p.put("ride_id","https://attacker.test");assertNull(RidePushTarget.parse(p,"member",1000));}
    @Test public void arrivalNeedsCustomerAndActualArrivalState(){Map<String,String> p=payload();p.put("alert_kind","arrival");assertNull(RidePushTarget.parse(p,"member",1000));p.put("ride_role","customer");p.put("ride_state","arrived");assertTrue(RidePushTarget.parse(p,"member",1000).path().startsWith("/go?ride=bike&bike-ride="));}
    @Test public void cabOwnerAndMalformedPayloads(){Map<String,String> p=payload();p.put("ride_kind","cab");p.put("ride_role","cab_owner");p.put("ride_state","requested");assertNotNull(RidePushTarget.parse(p,"member",1000));p.put("expires_at","9223372036854775808");assertNull(RidePushTarget.parse(p,"member",1000));}
    @Test public void completedNotificationOpensTheActualHistoryRecord(){Map<String,String> p=payload();p.put("alert_kind","update");p.put("ride_state","completed");assertTrue(RidePushTarget.parse(p,"member",1000).path().endsWith("&ride-history=1"));p.put("ride_role","customer");p.put("ride_kind","cab");assertEquals("/go?ride=cab&view=rides&ride-booking="+"a".repeat(64),RidePushTarget.parse(p,"member",1000).path());}
}
