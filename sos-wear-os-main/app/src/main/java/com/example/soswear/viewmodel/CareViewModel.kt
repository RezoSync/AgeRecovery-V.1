package com.example.soswear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.soswear.data.ApiException
import com.example.soswear.data.CareApi
import com.example.soswear.data.CarePlan
import com.example.soswear.data.DailyCare
import com.example.soswear.data.InvalidResponseException
import com.example.soswear.data.SosSettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

data class CareAppState(
    val initialized: Boolean = false,
    val loggedIn: Boolean = false,
    val isLoginLoading: Boolean = false,
    val loginError: String? = null,
    val code: String = "",
    val isHomeLoading: Boolean = false,
    val homeError: String? = null,
    val plan: CarePlan? = null,
    val care: List<DailyCare> = emptyList(),
    val pendingCareIds: Set<String> = emptySet(),
    val alarmCountdown: Int? = null,
    val isAlarmSending: Boolean = false,
    val alarmError: String? = null,
    val alarmMessage: String? = null,
)

class CareViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = SosSettingsRepository(application)
    private val api = CareApi()
    private val mutableState = MutableStateFlow(CareAppState())
    val state: StateFlow<CareAppState> = mutableState.asStateFlow()
    private var token: String? = null
    private var countdownJob: Job? = null

    init {
        viewModelScope.launch {
            token = repository.token.first()
            mutableState.value = mutableState.value.copy(
                initialized = true,
                loggedIn = token != null,
            )
            if (token != null) refreshHome()
        }
    }

    fun onCodeChanged(code: String) {
        mutableState.value = mutableState.value.copy(
            code = code.filter(Char::isDigit).take(6),
            loginError = null,
        )
    }

    fun login() {
        val code = mutableState.value.code
        if (code.length != 6) {
            mutableState.value = mutableState.value.copy(loginError = "Ingresa 6 dígitos")
            return
        }
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(isLoginLoading = true, loginError = null)
            try {
                val response = withContext(Dispatchers.IO) { api.login(code) }
                repository.saveToken(response.token)
                token = response.token
                mutableState.value = mutableState.value.copy(
                    loggedIn = true,
                    isLoginLoading = false,
                    loginError = null,
                )
                refreshHome()
            } catch (error: IOException) {
                mutableState.value = mutableState.value.copy(
                    isLoginLoading = false,
                    loginError = if (error is ApiException && error.statusCode == 401) {
                        "Código no válido"
                    } else if (error is ApiException) {
                        "No se pudo iniciar"
                    } else {
                        "Sin conexión"
                    },
                )
            } catch (_: InvalidResponseException) {
                mutableState.value = mutableState.value.copy(
                    isLoginLoading = false,
                    loginError = "No se pudo iniciar",
                )
            }
        }
    }

    fun refreshHome() {
        val authToken = token ?: return
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(isHomeLoading = true, homeError = null)
            try {
                val planCall = async(Dispatchers.IO) { api.getPlan(authToken) }
                val careCall = async(Dispatchers.IO) { api.getTodayCare(authToken) }
                val plan = planCall.await()
                val care = careCall.await()
                mutableState.value = mutableState.value.copy(
                    isHomeLoading = false,
                    homeError = null,
                    plan = plan,
                    care = care,
                )
            } catch (error: IOException) {
                if (error is ApiException && error.statusCode == 401) {
                    logout()
                } else {
                    mutableState.value = mutableState.value.copy(
                        isHomeLoading = false,
                        homeError = if (error !is ApiException) "Sin conexión" else "No se pudo cargar",
                    )
                }
            } catch (_: InvalidResponseException) {
                mutableState.value = mutableState.value.copy(
                    isHomeLoading = false,
                    homeError = "No se pudo cargar",
                )
            }
        }
    }

    fun markCare(item: DailyCare) {
        val authToken = token ?: return
        if (item.done || item.id in mutableState.value.pendingCareIds) return
        mutableState.value = mutableState.value.copy(
            care = mutableState.value.care.map { if (it.id == item.id) it.copy(done = true) else it },
            pendingCareIds = mutableState.value.pendingCareIds + item.id,
            homeError = null,
        )
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { api.markCare(authToken, item.id) }
                mutableState.value = mutableState.value.copy(
                    pendingCareIds = mutableState.value.pendingCareIds - item.id,
                )
            } catch (error: IOException) {
                if (error is ApiException && error.statusCode == 401) {
                    logout()
                } else {
                    mutableState.value = mutableState.value.copy(
                        care = mutableState.value.care.map {
                            if (it.id == item.id) it.copy(done = item.done) else it
                        },
                        pendingCareIds = mutableState.value.pendingCareIds - item.id,
                        homeError = if (error !is ApiException) "Sin conexión" else "No se pudo guardar",
                    )
                }
            } catch (_: InvalidResponseException) {
                mutableState.value = mutableState.value.copy(
                    care = mutableState.value.care.map {
                        if (it.id == item.id) it.copy(done = item.done) else it
                    },
                    pendingCareIds = mutableState.value.pendingCareIds - item.id,
                    homeError = "No se pudo guardar",
                )
            }
        }
    }

    fun beginAlarmCountdown() {
        countdownJob?.cancel()
        mutableState.value = mutableState.value.copy(
            alarmCountdown = 5,
            alarmError = null,
            alarmMessage = null,
        )
        countdownJob = viewModelScope.launch {
            for (seconds in 5 downTo 1) {
                mutableState.value = mutableState.value.copy(alarmCountdown = seconds)
                delay(1_000)
            }
            mutableState.value = mutableState.value.copy(alarmCountdown = null, isAlarmSending = true)
            sendAlarm()
        }
    }

    fun cancelAlarmCountdown() {
        countdownJob?.cancel()
        countdownJob = null
        mutableState.value = mutableState.value.copy(alarmCountdown = null)
    }

    fun clearAlarmMessage() {
        mutableState.value = mutableState.value.copy(alarmMessage = null, alarmError = null)
    }

    private suspend fun sendAlarm() {
        val authToken = token ?: return
        try {
            withContext(Dispatchers.IO) { api.sendAlarm(authToken) }
            mutableState.value = mutableState.value.copy(
                isAlarmSending = false,
                alarmMessage = "Alerta enviada",
            )
        } catch (error: IOException) {
            if (error is ApiException && error.statusCode == 401) {
                logout()
            } else {
                mutableState.value = mutableState.value.copy(
                    isAlarmSending = false,
                    alarmError = if (error !is ApiException) "Sin conexión" else "No se pudo enviar",
                )
            }
        } catch (_: InvalidResponseException) {
            mutableState.value = mutableState.value.copy(
                isAlarmSending = false,
                alarmError = "No se pudo enviar",
            )
        }
    }

    private fun logout() {
        token = null
        countdownJob?.cancel()
        viewModelScope.launch { repository.clearToken() }
        mutableState.value = CareAppState(initialized = true)
    }
}
