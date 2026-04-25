import { useState } from 'react'
import { Card, Typography, Space, Row, Col, Tag, Button, Divider } from 'antd'
import { DownloadOutlined, PrinterOutlined, SafetyCertificateOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

const GENDER_LABEL = { male: '男', female: '女' }

export default function ClinicalReport({ patient, checkData, result, selectedSku }) {
  const [showPreview, setShowPreview] = useState(false)

  const reportNo = 'GSX-' + Date.now().toString().slice(-8)
  const today = new Date().toLocaleDateString('zh-CN')

  const getRiskColor = (score) => {
    if (score >= 60) return '#ef4444'
    if (score >= 40) return '#f59e0b'
    return '#10b981'
  }

  const getRiskLabel = (score) => {
    if (score >= 60) return '高进展风险'
    if (score >= 40) return '中等进展风险'
    return '低进展风险'
  }

  if (!showPreview) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <SafetyCertificateOutlined style={{ fontSize: 64, color: '#1677ff', marginBottom: 16 }} />
        <Title level={4}>临床分析报告</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          生成后可打印或发送给患者家长，作为信任背书和成交辅助工具
        </Text>
        <Row gutter={16} justify="center">
          <Col>
            <Button type="primary" size="large" icon={<PrinterOutlined />} onClick={() => setShowPreview(true)}>
              生成报告预览
            </Button>
          </Col>
        </Row>
      </div>
    )
  }

  return (
    <div>
      <Card style={{
        maxWidth: 800, margin: '0 auto', padding: 24,
        borderTop: '4px solid #003366',
        boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
      }}>
        {/* Header */}
        <Row justify="space-between" align="top" style={{ marginBottom: 24 }}>
          <Col>
            <Title level={3} style={{ margin: 0, color: '#003366' }}>高视星近视临床分析报告</Title>
            <Text type="secondary" style={{ fontSize: 10 }}>GAOSHI XING CLINICAL DECISION SUPPORT SYSTEM</Text>
          </Col>
          <Col style={{ textAlign: 'right' }}>
            <Tag color="blue">编号: {reportNo}</Tag>
            <div><Text style={{ fontSize: 11, color: '#94a3b8' }}>生成日期: {today}</Text></div>
          </Col>
        </Row>

        <Divider style={{ margin: '12px 0' }} />

        {/* Part I: Patient Info */}
        <div style={{ marginBottom: 20 }}>
          <Tag style={{ marginBottom: 8, fontWeight: 700 }}>一、患者信息</Tag>
          <Row gutter={[16, 8]}>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>姓名：</Text><Text strong>{patient?.name}</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>年龄：</Text><Text strong>{patient?.age}岁</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>性别：</Text><Text strong>{GENDER_LABEL[patient?.gender] || '-'}</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>等效球镜：</Text><Text strong>{checkData?.se_od || '-'}D</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>眼轴长度：</Text><Text strong>{checkData?.al_od || '-'}mm</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>年眼轴增长：</Text><Text strong>{checkData?.al_growth || '-'}mm/yr</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>户外活动：</Text><Text strong>{checkData?.outdoor_hours || '-'}h/天</Text></Col>
            <Col span={8}><Text style={{ fontSize: 12, color: '#64748b' }}>父母近视：</Text><Text strong>{checkData?.parent_myopia === 'both' ? '双方' : checkData?.parent_myopia === 'one' ? '一方' : '无'}</Text></Col>
          </Row>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Part II: Risk Assessment */}
        <div style={{ marginBottom: 20 }}>
          <Tag style={{ marginBottom: 8, fontWeight: 700 }}>二、风险评估</Tag>
          <Row gutter={[16, 8]}>
            <Col span={8}>
              <Card size="small" style={{ background: '#f8fafc', textAlign: 'center' }}>
                <Text style={{ fontSize: 10, color: '#64748b' }}>综合风险评分</Text>
                <div>
                  <Text style={{ fontSize: 28, fontWeight: 900, color: getRiskColor(result?.totalScore) }}>{result?.totalScore}</Text>
                  <Text style={{ fontSize: 12, color: '#94a3b8' }}>/100</Text>
                </div>
              </Card>
            </Col>
            <Col span={16}>
              <Card size="small" style={{ background: '#f8fafc' }}>
                <Text style={{ fontSize: 12, color: '#64748b' }}>
                  患者当前<span style={{ color: getRiskColor(result?.totalScore), fontWeight: 700 }}>{getRiskLabel(result?.totalScore)}</span>，
                  18岁预计等效球镜 <Text strong>{result?.prediction18yo?.toFixed(2)}D</Text>。
                  遗传因素与环境负荷叠加，建议积极干预。
                </Text>
              </Card>
            </Col>
          </Row>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Part III: Recommendation */}
        <div style={{ marginBottom: 20 }}>
          <Tag style={{ marginBottom: 8, fontWeight: 700 }}>三、临床决策建议</Tag>
          <Card style={{ background: '#f0f9ff', border: '1px solid #bfdbfe' }}>
            <Space>
              <SafetyCertificateOutlined style={{ fontSize: 24, color: '#2563eb' }} />
              <div>
                <Text style={{ fontSize: 16, fontWeight: 800, color: '#1e40af' }}>{selectedSku || result?.recommendation}</Text>
                <br />
                <Text style={{ fontSize: 12, color: '#2563eb' }}>CDSS基于{result?.similarCases || 100}例相似病例推荐</Text>
              </div>
            </Space>
          </Card>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Footer */}
        <Row justify="space-between" align="middle">
          <Col>
            <Text style={{ fontSize: 10, color: '#94a3b8' }}>
              * 本报告由高视星CDSS生成，仅供临床参考，具体诊断需经视光师核准。
            </Text>
          </Col>
          <Col>
            <Space>
              <Button icon={<PrinterOutlined />} onClick={() => window.print()} size="small">打印</Button>
              <Button icon={<DownloadOutlined />} size="small">下载PDF</Button>
            </Space>
          </Col>
        </Row>
      </Card>
    </div>
  )
}
