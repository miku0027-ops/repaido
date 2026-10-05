package com.repaido.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ApiException(val code: Int, message: String): Exception(message)

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("repaido_session", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("repaido-token", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("repaido-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(token.toByteArray())
        prefs.edit().putString("token", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).apply()
    }
    fun token(): String? = runCatching {
        val bytes = Base64.decode(prefs.getString("token", null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
    }.getOrNull()
    fun clear() { prefs.edit().clear().apply() }
}

class Api(private val sessions: SessionStore) {
    suspend fun call(path: String, method: String = "GET", body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(BuildConfig.API_URL + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 10000
            connection.readTimeout = 15000
            connection.setRequestProperty("Accept", "application/json")
            sessions.token()?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            body?.let {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { out -> out.write(it.toString().toByteArray()) }
            }
            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (code !in 200..299) {
                val detail = json.opt("detail")
                throw ApiException(code, if (detail is String) detail else "Please check your details and try again.")
            }
            json
        } catch (e: ApiException) { throw e }
        catch (e: Exception) { throw ApiException(0, "We couldn’t connect. Check your internet connection and try again.") }
        finally { connection.disconnect() }
    }
}

data class Service(val id: String, val category: String, val name: String, val description: String, val price: Int, val duration: Int, val badge: String, val included: List<String>, val excluded: List<String>) {
    companion object {
        fun from(j: JSONObject) = Service(j.getString("id"), j.getString("category"), j.getString("name"), j.getString("description"), j.getInt("price_paise"), j.getInt("duration_minutes"), j.getString("badge"), j.getJSONArray("included").let { a -> List(a.length()) { a.getString(it) } }, j.getJSONArray("excluded").let { a -> List(a.length()) { a.getString(it) } })
    }
}
data class Category(val id: String, val name: String)
data class Booking(val id: String, val name: String, val status: String, val start: String, val price: Int, val address: String, val city: String, val professional: String?) {
    companion object {
        fun from(j: JSONObject) = Booking(j.getString("id"), j.getString("service_name"), j.getString("status"), j.getString("starts_at"), j.getInt("price_paise"), j.getString("address"), j.getString("city"), j.optString("professional_name").takeUnless { it == "null" || it.isBlank() })
    }
}
fun money(paise: Int) = "₹" + java.text.NumberFormat.getIntegerInstance(java.util.Locale("en", "IN")).format(paise / 100)
