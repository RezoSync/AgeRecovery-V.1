package com.example.soswear.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import com.example.soswear.ui.theme.SosWearTheme
import com.example.soswear.viewmodel.CareViewModel

@Composable
fun AgeRecoveryApp(careViewModel: CareViewModel = viewModel()) {
    val state by careViewModel.state.collectAsStateWithLifecycle()
    var showAlarm by remember { mutableStateOf(false) }

    LaunchedEffect(state.loggedIn) {
        if (!state.loggedIn) showAlarm = false
    }

    SosWearTheme {
        Scaffold(
            timeText = { TimeText() },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                !state.initialized -> CareLoginScreen(state, careViewModel::onCodeChanged, careViewModel::login)
                !state.loggedIn -> CareLoginScreen(state, careViewModel::onCodeChanged, careViewModel::login)
                showAlarm -> CareAlarmScreen(
                    state = state,
                    onStart = careViewModel::beginAlarmCountdown,
                    onCancel = careViewModel::cancelAlarmCountdown,
                    onBack = {
                        careViewModel.clearAlarmMessage()
                        showAlarm = false
                    },
                )
                else -> CareHomeScreen(
                    state = state,
                    onRefresh = careViewModel::refreshHome,
                    onMarkCare = careViewModel::markCare,
                    onAlarm = {
                        careViewModel.clearAlarmMessage()
                        showAlarm = true
                    },
                )
            }
        }
    }
}
