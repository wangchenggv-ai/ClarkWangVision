import { useState } from 'react'
import { Card, Row, Col, Tag, Typography, Space, Button, Collapse, Progress } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, InfoCircleOutlined, ExperimentOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

const PRODUCTS = [
  {
    sku: '小旋风 (入门级)',
    control: '40-50%',
    convenience: '★★★★★',
    cost: '约¥2,000-3,000',
    safety: '★★★★★',
    compliance: '低',
    desc: '远视储备下降期首选，适合低度数、低风险患者',
    color: '#10b981',
  },
  {
    sku: '时空之眼 (标准级)',
    control: '50-60%',
    convenience: '★★★★☆',
    cost: '约¥3,000-5,000',
    safety: '★★★★★',
    compliance: '中',
    desc: '微透镜离焦设计，适合常规中低度近视防控',
    color: '#3b82f6',
  },
  {
    sku: 'Ultra 系列 (强效点扩散)',
    control: '60-75%',
    convenience: '★★★★☆',
    cost: '约¥5,000-8,000',
    safety: '★★★★☆',
    compliance: '中',
    desc: '点扩散强效设计，适合调节滞后、高度近视遗传风险',
    color: '#8b5cf6',
  },
]

const PARENT_TAGS = [
  { key: 'evidence', label: '🔬 证据导向型', desc: '看重临床数据和研究证据', strategy: '展示RWS证据、相似病例效果对比表' },
  { key: 'price', label: '💰 价格敏感型', desc: '关注性价比', strategy: '突出长期价值、避免后续更多支出' },
  { key: 'anxious', label: '😟 焦虑型', desc: '担心安全问题', strategy: '展示安全性数据、国家指南背书' },
  { key: 'high_focus', label: '🧐 高关注型', desc: '已做大量调研', strategy: '展示深度证据、RWS论文原文' },
]

export default function SolutionCompare({ patient, result, checkData, selectedSku, onSelectSku }) {
  const [activeTags, setActiveTags] = useState([])
  const [showEvidence, setShowEvidence] = useState(false)

  const toggleTag = (key) => {
    setActiveTags(prev =>
      prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]
    )
  }

  const getRiskColor = (score) => {
    if (score >= 60) return '#ef4444'
    if (score >= 40) return '#f59e0b'
    return '#10b981'
  }

  const getRiskLabel = (score) => {
    if (score >= 60) return '高'
    if (score >= 40) return '中'
    return '低'
  }

  return (
    <div>
      {/* Risk Summary */}
      <Card style={{ marginBottom: 16, borderRadius: 12, background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)' }}>
        <Row gutter={24} align="middle">
          <Col xs={24} md={6}>
            <div style={{ textAlign: 'center' }}>
              <Text style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>综合风险评分</Text>
              <div style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 42, fontWeight: 900, color: getRiskColor(result.totalScore) }}>{result.totalScore}</Text>
                <Text style={{ fontSize: 14, color: '#94a3b8' }}>/100</Text>
              </div>
              <Tag color={result.totalScore >= 60 ? 'red' : result.totalScore >= 40 ? 'orange' : 'green'} style={{ marginTop: 4 }}>
                {getRiskLabel(result.totalScore)}风险
              </Tag>
            </div>
          </Col>
          <Col xs={24} md={10}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {[
                { label: '遗传基线', value: result.geneticScore, color: getRiskColor(result.geneticScore) },
                { label: '环境负荷', value: result.envScore, color: getRiskColor(result.envScore) },
                { label: '生理指标', value: result.physScore, color: getRiskColor(result.physScore) },
              ].map(item => (
                <div key={item.label}>
                  <Row justify="space-between" style={{ marginBottom: 2 }}>
                    <Text style={{ fontSize: 11 }}>{item.label}</Text>
                    <Text style={{ fontSize: 11, color: item.color, fontWeight: 700 }}>{getRiskLabel(item.value)}</Text>
                  </Row>
                  <Progress percent={item.value} showInfo={false} strokeColor={item.color} size="small" />
                </div>
              ))}
            </Space>
          </Col>
          <Col xs={24} md={8}>
            <div style={{ textAlign: 'center', padding: 16, background: 'white', borderRadius: 12, border: '1px solid #bfdbfe' }}>
              <Text style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>CDSS推荐方案</Text>
              <div style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 16, fontWeight: 800, color: '#1e40af' }}>{result.recommendation}</Text>
              </div>
              <Tag color="blue" style={{ marginTop: 4 }}>基于 {result.similarCases} 例相似病例</Tag>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Product Comparison */}
      <Title level={5} style={{ marginBottom: 12 }}>方案对比</Title>
      <Row gutter={[12, 12]}>
        {PRODUCTS.map(p => {
          const isRecommended = p.sku === result.recommendation
          const isSelected = p.sku === selectedSku
          return (
            <Col xs={24} md={8} key={p.sku}>
              <Card
                hoverable
                onClick={() => onSelectSku(p.sku)}
                style={{
                  borderRadius: 12,
                  border: isSelected ? `2px solid ${p.color}` : isRecommended ? '2px solid #bfdbfe' : '1px solid #e2e8f0',
                  background: isSelected ? '#f8faff' : 'white',
                  position: 'relative',
                  cursor: 'pointer',
                  height: '100%',
                }}
              >
                {isRecommended && (
                  <Tag color="blue" style={{ position: 'absolute', top: 8, right: 8 }}>CDSS推荐</Tag>
                )}
                {isSelected && (
                  <CheckCircleFilled style={{ position: 'absolute', top: 8, left: 8, color: p.color, fontSize: 18 }} />
                )}
                <Title level={5} style={{ marginBottom: 4, marginTop: 4 }}>{p.sku}</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>{p.desc}</Text>
                <div style={{ marginTop: 12 }}>
                  <Row justify="space-between" style={{ marginBottom: 2 }}>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>控制效果</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700 }}>{p.control}</Text>
                  </Row>
                  <Row justify="space-between" style={{ marginBottom: 2 }}>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>便利性</Text>
                    <Text style={{ fontSize: 11 }}>{p.convenience}</Text>
                  </Row>
                  <Row justify="space-between" style={{ marginBottom: 2 }}>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>年费用</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700 }}>{p.cost}</Text>
                  </Row>
                  <Row justify="space-between" style={{ marginBottom: 2 }}>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>安全性</Text>
                    <Text style={{ fontSize: 11 }}>{p.safety}</Text>
                  </Row>
                  <Row justify="space-between">
                    <Text style={{ fontSize: 11, color: '#64748b' }}>依从性要求</Text>
                    <Text style={{ fontSize: 11 }}>{p.compliance}</Text>
                  </Row>
                </div>
              </Card>
            </Col>
          )
        })}
      </Row>

      {/* Parent Tags */}
      <Card size="small" style={{ marginTop: 16, borderRadius: 12 }} title={<Space><InfoCircleOutlined />家长类型标签（影响推荐话术）</Space>}>
        <Row gutter={[8, 8]}>
          {PARENT_TAGS.map(tag => (
            <Col key={tag.key}>
              <Tag
                color={activeTags.includes(tag.key) ? 'blue' : 'default'}
                style={{ cursor: 'pointer', padding: '4px 12px', fontSize: 13, borderRadius: 20 }}
                onClick={() => toggleTag(tag.key)}
              >
                {tag.label}
              </Tag>
            </Col>
          ))}
        </Row>
        {activeTags.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, background: '#f0f5ff', borderRadius: 8 }}>
            <Text style={{ fontSize: 12, color: '#1e40af' }}>
              <Text strong>推荐策略：</Text>
              {activeTags.map(t => PARENT_TAGS.find(pt => pt.key === t)?.strategy).join('；')}
            </Text>
          </div>
        )}
      </Card>

      {/* Evidence */}
      <Collapse
        items={[{
          key: 'evidence',
          label: <Space><ExperimentOutlined />循证证据与专利支撑</Space>,
          children: (
            <div>
              <Card size="small" style={{ marginBottom: 8, background: '#f8fafc' }}>
                <Text style={{ fontSize: 12 }}><Text strong>【临床数据】</Text> 《IOVS》2023研究显示：点扩散设计相较于传统周边离焦可进一步延缓眼轴增长平均0.12mm/年。</Text>
              </Card>
              <Card size="small" style={{ marginBottom: 8, background: '#f8fafc' }}>
                <Text style={{ fontSize: 12 }}><Text strong>【核心专利】</Text> 发明专利ZL2022XXXXXXXX.X：一种具有非对称点阵设计的眼用透镜及其制作方法。</Text>
              </Card>
              <Card size="small" style={{ background: '#f8fafc' }}>
                <Text style={{ fontSize: 12 }}><Text strong>【RWS证据】</Text> 多中心真实世界研究显示，高视星系列产品12个月眼轴控制率达55-75%。</Text>
              </Card>
            </div>
          ),
        }]}
        style={{ marginTop: 12, borderRadius: 8 }}
      />
    </div>
  )
}
