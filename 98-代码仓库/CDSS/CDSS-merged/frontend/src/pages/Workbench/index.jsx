import { useState, useCallback } from 'react'
import {
  Card, Steps, Button, Typography, Space, Row, Col, Tag, Input, Select, DatePicker, Form,
  InputNumber, Radio, message, Empty, Modal, Avatar, List, Spin,
} from 'antd'
import {
  SearchOutlined, UserAddOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  FileTextOutlined, CheckCircleOutlined, EyeOutlined, BarChartOutlined,
  SolutionOutlined, ReadOutlined, RobotOutlined, LoadingOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import PatientEducation from '../../components/ConsultFlow/PatientEducation'
import SolutionCompare from '../../components/ConsultFlow/SolutionCompare'
import ClinicalReport from '../../components/ConsultFlow/ClinicalReport'

const { Title, Text } = Typography
const { TextArea } = Input

const STEPS = [
  { title: '选患者', icon: <SearchOutlined /> },
  { title: '检查录入', icon: <EyeOutlined /> },
  { title: '患者教育', icon: <ReadOutlined /> },
  { title: 'CDSS推荐', icon: <RobotOutlined /> },
  { title: '成交辅助', icon: <SolutionOutlined /> },
  { title: '完成', icon: <CheckCircleOutlined /> },
]

const GENDER_OPTIONS = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
]

const PARENT_MYOPIA_OPTIONS = [
  { label: '均无近视', value: 'none' },
  { label: '一方近视', value: 'one' },
  { label: '双方近视', value: 'both' },
]

const MOCK_PATIENTS = [
  { id: 1, name: '李明', gender: 'male', age: 8, parent_myopia: 'one', se: -2.50, al_od: 24.85, phone: '138****1234' },
  { id: 2, name: '张小花', gender: 'female', age: 10, parent_myopia: 'both', se: -3.75, al_od: 25.30, phone: '139****5678' },
  { id: 3, name: '王小天', gender: 'male', age: 6, parent_myopia: 'none', se: -1.00, al_od: 23.20, phone: '137****9012' },
]

export default function Workbench() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [checkData, setCheckData] = useState({
    se_od: '', al_od: '', al_growth: '', outdoor_hours: 1, near_work_hours: 3,
    bcc: 0.5, parent_myopia: 'one',
  })
  const [newPatientForm] = Form.useForm()

  // Mock CDSS analysis result
  const [analysisResult, setAnalysisResult] = useState(null)
  const [selectedSku, setSelectedSku] = useState(null)
  const [reportGenerated, setReportGenerated] = useState(false)

  const filteredPatients = MOCK_PATIENTS.filter(p =>
    p.name.includes(searchText) || (searchText && p.phone.includes(searchText))
  )

  const handleRunAnalysis = useCallback(() => {
    if (!selectedPatient || !checkData.se_od) {
      message.warning('请先录入检查数据')
      return
    }
    const se = parseFloat(checkData.se_od) || -2.50
    const al = parseFloat(checkData.al_od) || 24.85
    const growth = parseFloat(checkData.al_growth) || 0.35
    const outdoor = parseFloat(checkData.outdoor_hours) || 1
    const nearWork = parseFloat(checkData.near_work_hours) || 3
    const bcc = parseFloat(checkData.bcc) || 0.5

    // Risk scoring (simplified version of AI-Sales algorithm)
    let geneticScore = checkData.parent_myopia === 'both' ? 80 : checkData.parent_myopia === 'one' ? 50 : 20
    let envScore = outdoor < 1 ? 80 : outdoor < 2 ? 50 : 20
    let physScore = growth >= 0.35 ? 80 : growth >= 0.2 ? 50 : 20
    let totalScore = Math.round(geneticScore * 0.3 + envScore * 0.3 + physScore * 0.4)

    // Product recommendation
    let rec
    if (bcc > 0.75 || al > 25) rec = 'Ultra 系列 (强效点扩散)'
    else if (al > 24 || Math.abs(se) > 3) rec = '时空之眼 (标准级)'
    else rec = '小旋风 (入门级)'

    const result = {
      totalScore,
      geneticScore,
      envScore,
      physScore,
      geneticRisk: geneticScore >= 60 ? 'high' : geneticScore >= 40 ? 'medium' : 'low',
      envRisk: envScore >= 60 ? 'high' : envScore >= 40 ? 'medium' : 'low',
      physRisk: physScore >= 60 ? 'high' : physScore >= 40 ? 'medium' : 'low',
      recommendation: rec,
      prediction18yo: se - (18 - selectedPatient.age) * (totalScore / 100 * 1.0),
      similarCases: Math.floor(Math.random() * 200) + 100,
    }
    setAnalysisResult(result)
    setSelectedSku(rec)
  }, [selectedPatient, checkData])

  const handleNewPatient = async () => {
    try {
      const values = await newPatientForm.validateFields()
      const newPatient = {
        id: Date.now(),
        name: values.name,
        gender: values.gender,
        age: dayjs().diff(dayjs(values.birth_date), 'year'),
        phone: values.phone || '',
        parent_myopia: values.parent_myopia || 'none',
        se: 0,
        al_od: 0,
      }
      setSelectedPatient(newPatient)
      setShowNewForm(false)
      message.success('患者创建成功')
      setStep(1)
    } catch {
      // validation failed
    }
  }

  const nextStep = () => {
    if (step === 0 && !selectedPatient) {
      message.warning('请先选择或创建患者')
      return
    }
    if (step === 1 && !checkData.se_od) {
      message.warning('请至少录入等效球镜数据')
      return
    }
    if (step === 2) {
      handleRunAnalysis()
    }
    if (step + 1 < STEPS.length) setStep(s => s + 1)
  }

  const prevStep = () => setStep(s => Math.max(0, s - 1))

  const renderStepContent = () => {
    switch (step) {
      case 0: return renderPatientSelect()
      case 1: return renderCheckEntry()
      case 2: return renderPatientEducation()
      case 3: return renderCDSSResult()
      case 4: return renderSalesTools()
      case 5: return renderCompletion()
      default: return null
    }
  }

  const renderPatientSelect = () => (
    <div className="animate-fade-in">
      <Card style={{ marginBottom: 16 }}>
        <Input
          size="large"
          prefix={<SearchOutlined />}
          placeholder="搜索患者姓名或电话..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <List
          dataSource={filteredPatients}
          locale={{ emptyText: <Empty description="未找到匹配患者" /> }}
          renderItem={item => (
            <List.Item
              onClick={() => { setSelectedPatient(item); setCheckData(p => ({ ...p, parent_myopia: item.parent_myopia })) }}
              style={{
                cursor: 'pointer', borderRadius: 8, padding: '12px 16px',
                background: selectedPatient?.id === item.id ? '#e6f4ff' : 'transparent',
                border: selectedPatient?.id === item.id ? '1px solid #91caff' : '1px solid transparent',
                marginBottom: 4,
              }}
            >
              <List.Item.Meta
                avatar={<Avatar style={{ background: item.gender === 'male' ? '#1677ff' : '#eb2f96' }}>{item.name[0]}</Avatar>}
                title={<Text strong>{item.name} <Tag>{item.age}岁</Tag></Text>}
                description={`SE: ${item.se}D  AL: ${item.al_od}mm  ${item.phone}`}
              />
            </List.Item>
          )}
        />
      </Card>
      <Button icon={<UserAddOutlined />} onClick={() => setShowNewForm(true)} block>
        新建患者
      </Button>
      <Modal title="新建患者" open={showNewForm} onOk={handleNewPatient} onCancel={() => setShowNewForm(false)} okText="创建并继续">
        <Form form={newPatientForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="患者姓名" />
          </Form.Item>
          <Form.Item label="性别" name="gender" rules={[{ required: true, message: '请选择性别' }]}>
            <Radio.Group options={GENDER_OPTIONS} />
          </Form.Item>
          <Form.Item label="出生日期" name="birth_date" rules={[{ required: true, message: '请选择出生日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="联系电话" name="phone"><Input placeholder="选填" /></Form.Item>
          <Form.Item label="父母近视" name="parent_myopia">
            <Select options={PARENT_MYOPIA_OPTIONS} placeholder="请选择" allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )

  const renderCheckEntry = () => (
    <div className="animate-fade-in">
      <Card title={<Space><EyeOutlined />快速检查录入</Space>} style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          录入关键数据即可生成分析和教育内容，详细基线检查可后续补充
        </Text>
        <Row gutter={[24, 16]}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="等效球镜 SE (D)" required>
              <InputNumber
                style={{ width: '100%' }}
                step={0.25} placeholder="-2.50"
                value={checkData.se_od}
                onChange={v => setCheckData(p => ({ ...p, se_od: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="眼轴 AL (mm)">
              <InputNumber
                style={{ width: '100%' }}
                step={0.01} placeholder="24.85"
                value={checkData.al_od}
                onChange={v => setCheckData(p => ({ ...p, al_od: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="年眼轴增长 (mm/yr)">
              <InputNumber
                style={{ width: '100%' }}
                step={0.01} placeholder="0.35"
                value={checkData.al_growth}
                onChange={v => setCheckData(p => ({ ...p, al_growth: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="调节滞后 BCC (D)">
              <InputNumber
                style={{ width: '100%' }}
                step={0.25} placeholder="0.50"
                value={checkData.bcc}
                onChange={v => setCheckData(p => ({ ...p, bcc: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="日均户外 (h)">
              <InputNumber min={0} max={16} step={0.5} style={{ width: '100%' }}
                value={checkData.outdoor_hours}
                onChange={v => setCheckData(p => ({ ...p, outdoor_hours: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="日均近距用眼 (h)">
              <InputNumber min={0} max={16} step={0.5} style={{ width: '100%' }}
                value={checkData.near_work_hours}
                onChange={v => setCheckData(p => ({ ...p, near_work_hours: v }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="父母近视">
              <Select value={checkData.parent_myopia} onChange={v => setCheckData(p => ({ ...p, parent_myopia: v }))}
                options={PARENT_MYOPIA_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
      </Card>
    </div>
  )

  const renderPatientEducation = () => (
    <div className="animate-fade-in">
      <PatientEducation
        patientName={selectedPatient?.name}
        age={selectedPatient?.age}
        se={parseFloat(checkData.se_od) || -2.50}
        al={parseFloat(checkData.al_od) || 24.85}
        alGrowth={parseFloat(checkData.al_growth) || 0.35}
        outdoorHours={parseFloat(checkData.outdoor_hours) || 1}
      />
    </div>
  )

  const renderCDSSResult = () => {
    if (!analysisResult) {
      return <Card><Spin tip="分析中..." /></Card>
    }
    return (
      <div className="animate-fade-in">
        <SolutionCompare
          patient={selectedPatient}
          result={analysisResult}
          checkData={checkData}
          selectedSku={selectedSku}
          onSelectSku={setSelectedSku}
        />
      </div>
    )
  }

  const renderSalesTools = () => {
    if (!analysisResult) return null
    return (
      <div className="animate-fade-in">
        <ClinicalReport
          patient={selectedPatient}
          checkData={checkData}
          result={analysisResult}
          selectedSku={selectedSku}
        />
      </div>
    )
  }

  const renderCompletion = () => (
    <div style={{ textAlign: 'center', padding: '60px 0' }} className="animate-fade-in">
      <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 24 }} />
      <Title level={3}>本次接诊完成</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
        患者 {selectedPatient?.name} 的接诊数据已保存，可前往患者管理查看完整记录
      </Text>
      <Space>
        <Button type="primary" size="large" onClick={() => { setStep(0); setSelectedPatient(null); setAnalysisResult(null) }}>
          开始下一位患者
        </Button>
        {selectedPatient && (
          <Button size="large" onClick={() => navigate(`/patients/${selectedPatient.id}`)}>
            查看患者档案
          </Button>
        )}
      </Space>
    </div>
  )

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Patient bar */}
      {selectedPatient && step > 0 && (
        <Card size="small" style={{ marginBottom: 16, background: '#f6f8ff' }}>
          <Space>
            <Avatar style={{ background: selectedPatient.gender === 'male' ? '#1677ff' : '#eb2f96' }}>
              {selectedPatient.name[0]}
            </Avatar>
            <Text strong>{selectedPatient.name}</Text>
            <Tag>{selectedPatient.age}岁</Tag>
            {checkData.se_od && <Tag color="blue">SE: {checkData.se_od}D</Tag>}
            {analysisResult && (
              <Tag color={analysisResult.totalScore > 60 ? 'red' : analysisResult.totalScore > 40 ? 'orange' : 'green'}>
                风险: {analysisResult.totalScore}分
              </Tag>
            )}
          </Space>
        </Card>
      )}

      {/* Steps */}
      <Steps current={step} items={STEPS} style={{ marginBottom: 24 }} />

      {/* Content */}
      <Card style={{ minHeight: 400, borderTop: step === 2 ? 'none' : undefined }}>
        {renderStepContent()}
      </Card>

      {/* Navigation */}
      <Row justify="space-between" style={{ marginTop: 24 }}>
        <Col>
          {step > 0 && <Button icon={<ArrowLeftOutlined />} onClick={prevStep}>上一步</Button>}
        </Col>
        <Col>
          {step < STEPS.length - 1 ? (
            <Button type="primary" onClick={nextStep} icon={<ArrowRightOutlined />}>
              {step === 2 ? '查看CDSS推荐' : step === 3 ? '查看成交辅助' : step === 4 ? '生成报告并完成' : '下一步'}
            </Button>
          ) : null}
        </Col>
      </Row>
    </div>
  )
}
