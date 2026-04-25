import { useState } from 'react'
import { Card, Typography, Space, Row, Col, Tag } from 'antd'

const { Text, Title } = Typography

const CONTROL_RATES = {
  natural: 0,
  lifestyle: 0.30,
  optical: 0.55,
  intensive: 0.75,
}

const MODE_LABELS = {
  natural: '不干预',
  lifestyle: '生活方式',
  optical: '离焦镜片',
  intensive: '强化组合',
}

const MODE_COLORS = {
  natural: '#ef4444',
  lifestyle: '#f59e0b',
  optical: '#3b82f6',
  intensive: '#10b981',
}

function EyeSVG({ al, label, activeMode, color }) {
  const cx = 160, cy = 130, vRadius = 60
  const elongation = Math.max(0, (al - 23.5) * 15)
  const hRadiusPosterior = vRadius + elongation

  return (
    <div style={{ textAlign: 'center' }}>
      <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        {label}
      </Text>
      <div style={{ margin: '4px 0 8px' }}>
        <Text style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: '-0.03em' }}>{al.toFixed(2)}</Text>
        <Text style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>mm</Text>
      </div>
      <svg viewBox="0 0 320 260" style={{ width: '100%', maxHeight: 200 }}>
        <defs>
          <radialGradient id={`eye-${label}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f8fafc" />
          </radialGradient>
        </defs>
        <path d={`M ${cx} ${cy - vRadius} A ${vRadius} ${vRadius} 0 0 0 ${cx} ${cy + vRadius} A ${hRadiusPosterior} ${vRadius} 0 0 0 ${cx} ${cy - vRadius}`}
          fill={`url(#eye-${label})`} stroke="#e2e8f0" strokeWidth="1" />
        {al > 23.5 && (
          <path d={`M ${cx} ${cy - vRadius} A ${hRadiusPosterior} ${vRadius} 0 0 1 ${cx} ${cy + vRadius}`}
            fill="none" stroke={activeMode === 'natural' ? '#ef4444' : '#3b82f6'} strokeWidth="3" strokeDasharray="4 2" opacity="0.6" />
        )}
        <line x1={cx - vRadius - 10} y1={cy} x2={cx + hRadiusPosterior} y2={cy} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="5 5" />
        <path d={`M ${cx - vRadius} ${cy - 30} Q ${cx - vRadius - 18} ${cy} ${cx - vRadius} ${cy + 30}`} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" />
        <text x={cx + hRadiusPosterior - 30} y={cy + vRadius + 20} style={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8', textTransform: 'uppercase' }}>
          AL: {al.toFixed(2)}mm
        </text>
      </svg>
    </div>
  )
}

export default function PatientEducation({ patientName, age, se, al, alGrowth, outdoorHours }) {
  const [activeMode, setActiveMode] = useState('natural')

  const yearsTo18 = 18 - age
  const currentGrowth = alGrowth || 0.40

  const getPrediction = (mode) => {
    const alAt18 = al + yearsTo18 * currentGrowth * (1 - CONTROL_RATES[mode])
    const alSaved = al + yearsTo18 * currentGrowth - alAt18
    const diopterAt18 = se - (alAt18 - al) * 2.75
    const riskReduction = mode === 'natural' ? 0 : Math.round(alSaved / (currentGrowth * yearsTo18) * 100)
    return { alAt18, alSaved, diopterAt18, riskReduction }
  }

  const predictions = Object.keys(CONTROL_RATES).reduce((acc, mode) => {
    acc[mode] = getPrediction(mode)
    return acc
  }, {})

  return (
    <div>
      <Card style={{ marginBottom: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16 }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          {patientName || '患者'} · 18岁眼轴预测
        </Title>
        <Text type="secondary">基于当前数据模拟不同干预方案下18岁时的眼球发育情况</Text>

        <Row gutter={16} style={{ marginTop: 20 }}>
          <Col xs={24} md={12}>
            <div style={{ background: 'white', borderRadius: 16, padding: 16, border: '1px solid #e2e8f0' }}>
              <EyeSVG al={al} label="当前眼轴" activeMode="natural" color="#1e293b" />
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div style={{ background: 'white', borderRadius: 16, padding: 16, border: activeMode === 'natural' ? '1px solid #fecaca' : '1px solid #bfdbfe' }}>
              <EyeSVG al={predictions[activeMode].alAt18} label={`预测: ${MODE_LABELS[activeMode]}`}
                activeMode={activeMode} color={activeMode === 'natural' ? '#ef4444' : '#2563eb'} />
            </div>
          </Col>
        </Row>

        <Row gutter={8} style={{ marginTop: 16 }}>
          {Object.entries(MODE_LABELS).map(([key, label]) => (
            <Col key={key}>
              <Tag
                color={activeMode === key ? 'blue' : 'default'}
                style={{ cursor: 'pointer', padding: '4px 12px', fontSize: 13 }}
                onClick={() => setActiveMode(key)}
              >
                {label}
              </Tag>
            </Col>
          ))}
        </Row>
      </Card>

      <Row gutter={[12, 12]}>
        {Object.entries(CONTROL_RATES).map(([mode]) => {
          const stats = predictions[mode]
          const isNatural = mode === 'natural'
          return (
            <Col xs={12} md={6} key={mode}>
              <Card size="small" style={{
                background: isNatural ? '#fef2f2' : '#f8fafc',
                border: activeMode === mode ? `2px solid ${MODE_COLORS[mode]}` : '1px solid #e2e8f0',
                borderRadius: 12, cursor: 'pointer',
              }} onClick={() => setActiveMode(mode)}>
                <Text style={{ fontSize: 10, fontWeight: 700, color: isNatural ? '#dc2626' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {MODE_LABELS[mode]}
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>18岁眼轴 </Text>
                  <Text strong style={{ color: isNatural ? '#dc2626' : '#1e293b' }}>{stats.alAt18.toFixed(2)}mm</Text>
                </div>
                <div>
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>18岁度数 </Text>
                  <Text strong>{stats.diopterAt18.toFixed(2)}D</Text>
                </div>
                {!isNatural && (
                  <div style={{ marginTop: 4 }}>
                    <Tag color="green" style={{ fontSize: 10 }}>有效 {stats.riskReduction}%</Tag>
                  </div>
                )}
                {isNatural && (
                  <div style={{ marginTop: 4 }}>
                    <Tag color="red" style={{ fontSize: 10 }}>高风险进展</Tag>
                  </div>
                )}
              </Card>
            </Col>
          )
        })}
      </Row>

      <Card size="small" style={{ marginTop: 16, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
        <Text style={{ fontSize: 12, color: '#0369a1' }}>
          <Text strong style={{ color: '#0369a1' }}>视光师话术提示：</Text>
          "您看，如果不干预，孩子18岁时眼轴会达到 {predictions.natural.alAt18.toFixed(2)}mm，接近病理性阈值。
          如果采用{activeMode === 'natural' ? '光学干预' : MODE_LABELS[activeMode]}，18岁眼轴可控制在 {predictions[activeMode].alAt18.toFixed(2)}mm，
          少增长 {(predictions.natural.alAt18 - predictions[activeMode].alAt18).toFixed(2)}mm，相当于度数少加深约{((predictions.natural.alAt18 - predictions[activeMode].alAt18) * 2.75).toFixed(2)}D。"
        </Text>
      </Card>
    </div>
  )
}
