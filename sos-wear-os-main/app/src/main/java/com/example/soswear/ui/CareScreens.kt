package com.example.soswear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.example.soswear.viewmodel.CareAppState

private val AlertRed = Color(0xFFE53935)

@Composable
fun CareLoginScreen(
    state: CareAppState,
    onCodeChanged: (String) -> Unit,
    onLogin: () -> Unit,
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        autoCentering = AutoCenteringParams(itemIndex = 0),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item {
            Text(
                "Age Recovery",
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        item {
            Text(
                "Código de acceso",
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        item {
            BasicTextField(
                value = state.code,
                onValueChange = onCodeChanged,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                textStyle = MaterialTheme.typography.title2.copy(
                    color = MaterialTheme.colors.onBackground,
                    textAlign = TextAlign.Center,
                    letterSpacing = 8.sp,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
            )
        }
        item {
            Chip(
                onClick = onLogin,
                enabled = !state.isLoginLoading && state.code.length == 6,
                modifier = Modifier.fillMaxWidth(0.84f),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                label = {
                    Text(
                        "Confirmar",
                        modifier = Modifier.fillMaxWidth(),
                        fontSize = 11.sp,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                    )
                },
            )
        }
        if (!state.initialized || state.isLoginLoading) {
            item { CircularProgressIndicator() }
        }
        state.loginError?.let { message ->
            item {
                Text(
                    message,
                    color = Color(0xFFFF777D),
                    fontSize = 10.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun CareHomeScreen(
    state: CareAppState,
    onRefresh: () -> Unit,
    onMarkCare: (com.example.soswear.data.DailyCare) -> Unit,
    onAlarm: () -> Unit,
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        autoCentering = AutoCenteringParams(itemIndex = 0),
        contentPadding = PaddingValues(start = 24.dp, top = 12.dp, end = 24.dp, bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        state.plan?.let { plan ->
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        plan.treatment,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        fontSize = 13.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "Día ${plan.currentDay} de ${plan.totalDays}",
                        fontSize = 11.sp,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                    )
                }
            }
        }
        if (state.isHomeLoading) {
            item { CircularProgressIndicator() }
        } else if (state.homeError != null) {
            item {
                Text(
                    state.homeError,
                    color = Color(0xFFFF777D),
                    textAlign = TextAlign.Center,
                    fontSize = 10.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            item {
                Chip(
                    label = {
                        Text(
                            "Reintentar",
                            modifier = Modifier.fillMaxWidth(),
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center,
                        )
                    },
                    onClick = onRefresh,
                    modifier = Modifier.fillMaxWidth(0.9f),
                )
            }
        } else if (state.plan != null && state.care.isEmpty()) {
            item {
                Text(
                    "Sin cuidados para hoy",
                    textAlign = TextAlign.Center,
                    fontSize = 11.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        } else {
            state.care.forEach { item ->
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colors.surface, RoundedCornerShape(12.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            item.title,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            fontSize = 11.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            item.instruction,
                            textAlign = TextAlign.Center,
                            fontSize = 9.sp,
                            lineHeight = 12.sp,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (item.done) {
                            Chip(
                                onClick = {},
                                enabled = false,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = Color(0xFF34383D),
                                    contentColor = Color(0xFF9AA0A6),
                                    disabledBackgroundColor = Color(0xFF34383D),
                                    disabledContentColor = Color(0xFF777D83),
                                ),
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                label = {
                                    Text(
                                        "Hecho ✓",
                                        modifier = Modifier.fillMaxWidth(),
                                        fontSize = 10.sp,
                                        maxLines = 1,
                                        textAlign = TextAlign.Center,
                                    )
                                },
                            )
                        } else {
                            Chip(
                                onClick = { onMarkCare(item) },
                                enabled = item.id !in state.pendingCareIds,
                                modifier = Modifier.fillMaxWidth(),
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                label = {
                                    Text(
                                        "Marcar hecho",
                                        modifier = Modifier.fillMaxWidth(),
                                        fontSize = 10.sp,
                                        maxLines = 1,
                                        textAlign = TextAlign.Center,
                                    )
                                },
                            )
                        }
                    }
                }
            }
        }
        item {
            Chip(
                onClick = onAlarm,
                modifier = Modifier
                    .fillMaxWidth(0.84f)
                    .padding(top = 8.dp),
                colors = ChipDefaults.primaryChipColors(
                    backgroundColor = AlertRed,
                    contentColor = Color.White,
                ),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                label = {
                    Text(
                        "Señal de alarma",
                        modifier = Modifier.fillMaxWidth(),
                        fontSize = 11.sp,
                        maxLines = 2,
                        textAlign = TextAlign.Center,
                    )
                },
            )
        }
    }
}

@Composable
fun CareAlarmScreen(
    state: CareAppState,
    onStart: () -> Unit,
    onCancel: () -> Unit,
    onBack: () -> Unit,
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        autoCentering = AutoCenteringParams(itemIndex = 0),
        contentPadding = PaddingValues(start = 30.dp, top = 20.dp, end = 30.dp, bottom = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item {
            Text(
                "Si es una emergencia, llama al 911",
                textAlign = TextAlign.Center,
                fontSize = 11.sp,
                lineHeight = 13.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (state.alarmCountdown != null) {
            item {
                Text(
                    state.alarmCountdown.toString(),
                    fontSize = 40.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                )
            }
            item {
                Chip(
                    onClick = onCancel,
                    modifier = Modifier.fillMaxWidth(0.84f),
                    colors = ChipDefaults.chipColors(
                        backgroundColor = Color(0xFF41464F),
                        contentColor = Color.White,
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    label = {
                        Text(
                            "Cancelar",
                            modifier = Modifier.fillMaxWidth(),
                            fontSize = 11.sp,
                            maxLines = 1,
                            textAlign = TextAlign.Center,
                        )
                    },
                )
            }
        } else if (state.isAlarmSending) {
            item { CircularProgressIndicator() }
            item { Text("Enviando alerta", fontSize = 11.sp, maxLines = 2, textAlign = TextAlign.Center) }
        } else {
            item {
                Chip(
                    onClick = onStart,
                    modifier = Modifier.fillMaxWidth(0.84f),
                    colors = ChipDefaults.primaryChipColors(
                        backgroundColor = AlertRed,
                        contentColor = Color.White,
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    label = {
                        Text(
                            "Señal de alarma",
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                            fontSize = 11.sp,
                            maxLines = 2,
                        )
                    },
                )
            }
        }
        state.alarmMessage?.let {
            item {
                Text(
                    it,
                    color = Color(0xFF8FE3A1),
                    textAlign = TextAlign.Center,
                    fontSize = 10.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        state.alarmError?.let {
            item {
                Text(
                    it,
                    color = Color(0xFFFF777D),
                    textAlign = TextAlign.Center,
                    fontSize = 10.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (state.alarmCountdown == null && !state.isAlarmSending) {
            item {
                Chip(
                    label = {
                        Text(
                            "Volver",
                            modifier = Modifier.fillMaxWidth(),
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center,
                        )
                    },
                    onClick = onBack,
                    modifier = Modifier.fillMaxWidth(0.84f),
                )
            }
        }
    }
}
