package com.repaido.app

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

class AppState(app: Application): AndroidViewModel(app) {
    private val sessions = SessionStore(app)
    private val api = Api(sessions)
    private val prefs = app.getSharedPreferences("preferences", 0)
    var services by mutableStateOf(emptyList<Service>())
    var categories by mutableStateOf(emptyList<Category>())
    var cities by mutableStateOf(emptyList<String>())
    var city by mutableStateOf(prefs.getString("city", "Bengaluru") ?: "Bengaluru")
    var name by mutableStateOf("")
    var email by mutableStateOf("")
    var signedIn by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var page by mutableStateOf("home")
    var query by mutableStateOf("")
    var category by mutableStateOf("all")
    var selected by mutableStateOf<Service?>(null)
    var step by mutableIntStateOf(0)
    var slots by mutableStateOf(emptyList<String>())
    var slotLoading by mutableStateOf(false)
    var slot by mutableStateOf("")
    var address by mutableStateOf("")
    var phone by mutableStateOf("")
    var notes by mutableStateOf("")
    var bookings by mutableStateOf(emptyList<Booking>())
    var bookingsLoading by mutableStateOf(false)
    var receipt by mutableStateOf<Booking?>(null)
    var authOpen by mutableStateOf(false)
    var cityOpen by mutableStateOf(false)
    var cancelTarget by mutableStateOf<Booking?>(null)
    private var requestKey = UUID.randomUUID().toString()
    init { reload() }
    fun clearError() { error = null }
    private fun failure(e: Exception) {
        error = e.message ?: "Something went wrong. Please try again."
        if (e is ApiException && e.code == 401) {
            sessions.clear(); signedIn = false; name = ""; email = ""; bookings = emptyList()
        }
    }
    fun reload() = viewModelScope.launch {
        loading = true; error = null
        try {
            val j = api.call("/catalog")
            services = j.getJSONArray("services").let { a -> List(a.length()) { Service.from(a.getJSONObject(it)) } }
            categories = j.getJSONArray("categories").let { a -> List(a.length()) { val c=a.getJSONObject(it); Category(c.getString("id"), c.getString("name")) } }
            cities = j.getJSONArray("cities").let { a -> List(a.length()) { a.getString(it) } }
            if (city !in cities) changeCity(cities.first())
            if (sessions.token() != null) {
                val user = api.call("/auth/me"); name = user.getString("name"); email = user.getString("email"); signedIn = true
            }
        } catch (e: Exception) { failure(e) }
        finally { loading = false }
    }
    fun changeCity(value: String) { city=value; prefs.edit().putString("city", value).apply(); cityOpen=false; slot="" }
    fun choose(service: Service) { selected=service; step=0; slot=""; notes=""; error=null; requestKey=UUID.randomUUID().toString() }
    fun loadSlots() = viewModelScope.launch {
        val service = selected ?: return@launch
        step=1; slotLoading=true; error=null; slots=emptyList()
        try {
            val j=api.call("/slots?service_id=${service.id}&city=${URLEncoder.encode(city,"UTF-8")}")
            slots=j.getJSONArray("slots").let { a -> List(a.length()) { a.getJSONObject(it).getString("starts_at") } }
            if (slot !in slots) slot=""
        } catch(e:Exception) { failure(e) }
        finally { slotLoading=false }
    }
    fun authenticate(register: Boolean, userName: String, userEmail: String, password: String) = viewModelScope.launch {
        if (busy) return@launch
        busy=true; error=null
        try {
            val body=JSONObject().put("email", userEmail.trim()).put("password", password)
            if(register) body.put("name", userName.trim())
            val j=api.call(if(register) "/auth/register" else "/auth/login", "POST", body)
            sessions.save(j.getString("token")); val user=j.getJSONObject("user")
            name=user.getString("name"); email=user.getString("email"); signedIn=true; authOpen=false
            if(page=="bookings") fetchBookings()
        } catch(e:Exception) { failure(e) }
        finally { busy=false }
    }
    fun logout() = viewModelScope.launch {
        if(busy) return@launch
        busy=true; error=null
        try {
            api.call("/auth/logout", "POST")
            sessions.clear(); signedIn=false; name=""; email=""; bookings=emptyList(); address=""; phone=""; notes=""; page="home"
        } catch(e:Exception) { failure(e) }
        finally { busy=false }
    }
    fun fetchBookings() = viewModelScope.launch {
        if(!signedIn) return@launch
        bookingsLoading=true; error=null
        try { val j=api.call("/bookings"); bookings=j.getJSONArray("bookings").let { a -> List(a.length()) { Booking.from(a.getJSONObject(it)) } } }
        catch(e:Exception) { failure(e) }
        finally { bookingsLoading=false }
    }
    fun submitBooking() = viewModelScope.launch {
        if(busy) return@launch
        if(!signedIn) { authOpen=true; return@launch }
        val service=selected ?: return@launch
        busy=true; error=null
        try {
            val body=JSONObject().put("service_id",service.id).put("city",city).put("address",address.trim()).put("phone",phone).put("notes",notes.trim()).put("starts_at",slot).put("idempotency_key",requestKey)
            receipt=Booking.from(api.call("/bookings","POST",body)); selected=null; page="bookings"; fetchBookings()
        } catch(e:Exception) {
            failure(e)
            if(e is ApiException && e.code==409) { step=1; slot=""; slots=emptyList() }
        }
        finally { busy=false }
    }
    fun cancelBooking() = viewModelScope.launch {
        val booking=cancelTarget ?: return@launch
        if(busy) return@launch
        busy=true; error=null
        try { api.call("/bookings/${booking.id}/cancel","POST"); cancelTarget=null; fetchBookings() }
        catch(e:Exception) { failure(e) }
        finally { busy=false }
    }
    fun navigate(to: String) { page=to; error=null; if(to=="bookings") fetchBookings() }
}
