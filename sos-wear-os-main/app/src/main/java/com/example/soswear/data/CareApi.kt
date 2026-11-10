package com.example.soswear.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class LoginResponse(
    val token: String,
    val patientId: String,
    val patientName: String,
    val language: String?,
)

data class CarePlan(
    val treatment: String,
    val procedureDate: String,
    val currentDay: Int,
    val totalDays: Int,
    val stage: String,
)

data class DailyCare(
    val id: String,
    val title: String,
    val instruction: String,
    val done: Boolean,
)

class ApiException(val statusCode: Int) : IOException()
class InvalidResponseException : Exception()

class CareApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .writeTimeout(6, TimeUnit.SECONDS)
        .build()

    suspend fun login(code: String): LoginResponse {
        val body = JSONObject().put("codigo", code)
        val json = execute("/api/login", body, token = null)
        val patient = json.optJSONObject("paciente") ?: throw InvalidResponseException()
        return LoginResponse(
            token = json.requiredString("token"),
            patientId = patient.requiredString("id_paciente"),
            patientName = patient.requiredString("nombre"),
            language = patient.optString("idioma").takeIf(String::isNotBlank),
        )
    }

    suspend fun getPlan(token: String): CarePlan {
        val json = execute("/api/plan", token = token)
        return CarePlan(
            treatment = json.requiredString("tratamiento"),
            procedureDate = json.optString("fecha_procedimiento"),
            currentDay = json.requiredInt("dia_actual"),
            totalDays = json.requiredInt("plan_dias"),
            stage = json.optString("etapa"),
        )
    }

    suspend fun getTodayCare(token: String): List<DailyCare> {
        val json = execute("/api/cuidados/hoy", token = token)
        val items = json.optJSONArray("cuidados") ?: throw InvalidResponseException()
        return List(items.length()) { index ->
            val item = items.optJSONObject(index) ?: throw InvalidResponseException()
            DailyCare(
                id = item.requiredString("id_cuidado"),
                title = item.requiredString("titulo"),
                instruction = item.requiredString("instruccion"),
                done = item.optInt("hecho") == 1,
            )
        }
    }

    suspend fun markCare(token: String, id: String) {
        val url = apiUrl("/api/cuidados", id, "marcar")
        if (!execute(url, JSONObject().put("origen", "reloj"), token).optBoolean("ok")) {
            throw InvalidResponseException()
        }
    }

    suspend fun sendAlarm(token: String) {
        if (!execute("/api/alarmas", JSONObject(), token).optBoolean("ok")) {
            throw InvalidResponseException()
        }
    }

    private suspend fun execute(
        path: String,
        body: JSONObject? = null,
        token: String?,
    ): JSONObject = execute(apiUrl(path), body, token)

    private suspend fun execute(
        url: okhttp3.HttpUrl,
        body: JSONObject?,
        token: String?,
    ): JSONObject {
        val request = Request.Builder()
            .url(url)
            .apply {
                if (token != null) header("Authorization", "Bearer $token")
                if (body != null) {
                    post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                } else {
                    get()
                }
            }
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (response.code == 401) throw ApiException(401)
                if (!response.isSuccessful) throw ApiException(response.code)
                val responseBody = response.body?.string().orEmpty()
                try {
                    JSONObject(responseBody)
                } catch (error: JSONException) {
                    throw InvalidResponseException()
                }
            }
        } catch (error: IllegalArgumentException) {
            throw IOException("No se pudo procesar la respuesta", error)
        }
    }

    private fun apiUrl(path: String, vararg segments: String) =
        BASE_URL.toHttpUrl().newBuilder()
            .addPathSegments(path.trimStart('/'))
            .apply { segments.forEach(::addPathSegment) }
            .build()

    private fun JSONObject.requiredString(key: String): String =
        optString(key).takeIf(String::isNotBlank) ?: throw InvalidResponseException()

    private fun JSONObject.requiredInt(key: String): Int {
        if (!has(key) || isNull(key)) throw InvalidResponseException()
        return try {
            getInt(key)
        } catch (_: JSONException) {
            throw InvalidResponseException()
        }
    }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
