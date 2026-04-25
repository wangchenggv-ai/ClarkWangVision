import { Form, InputNumber, Row, Col, Typography } from 'antd'

const { Title } = Typography

/**
 * EyeDataForm — reusable bilateral eye data entry component.
 *
 * Props:
 *   side                {string}  Display label, e.g. 'OD' or 'OS'
 *   prefix              {string}  Form field name prefix, e.g. 'od' or 'os'
 *   form                {object}  Ant Design form instance (passed for context; fields are
 *                                 registered via Form.Item name arrays so no direct use needed)
 *   includeCorneaCurvature {bool} Whether to render K1 / K2 fields (default false)
 */
export default function EyeDataForm({ side, prefix, includeCorneaCurvature = false }) {
  const sideLabel = side === 'OD' ? '右眼 (OD)' : '左眼 (OS)'

  return (
    <div style={{ marginBottom: 8 }}>
      <Title level={5} style={{ marginBottom: 12, color: '#1677ff' }}>
        {sideLabel}
      </Title>

      <Row gutter={[16, 0]}>
        {/* 球镜 Sph */}
        <Col xs={24} sm={12}>
          <Form.Item
            label="球镜 Sph"
            name={[prefix, 'sph']}
          >
            <InputNumber
              step={0.25}
              min={-30}
              max={10}
              addonAfter="D"
              style={{ width: '100%' }}
              placeholder="0.00"
            />
          </Form.Item>
        </Col>

        {/* 柱镜 Cyl */}
        <Col xs={24} sm={12}>
          <Form.Item
            label="柱镜 Cyl"
            name={[prefix, 'cyl']}
          >
            <InputNumber
              step={0.25}
              min={-10}
              max={0}
              addonAfter="D"
              style={{ width: '100%' }}
              placeholder="0.00"
            />
          </Form.Item>
        </Col>

        {/* 轴向 Axis */}
        <Col xs={24} sm={12}>
          <Form.Item
            label="轴向 Axis"
            name={[prefix, 'axis']}
          >
            <InputNumber
              min={0}
              max={180}
              addonAfter="°"
              style={{ width: '100%' }}
              placeholder="0"
            />
          </Form.Item>
        </Col>

        {/* 视力 VA */}
        <Col xs={24} sm={12}>
          <Form.Item
            label="视力 VA"
            name={[prefix, 'va']}
          >
            <InputNumber
              step={0.1}
              min={0}
              max={2.0}
              style={{ width: '100%' }}
              placeholder="1.0"
            />
          </Form.Item>
        </Col>

        {/* 眼轴 AL */}
        <Col xs={24} sm={12}>
          <Form.Item
            label="眼轴 AL"
            name={[prefix, 'al']}
          >
            <InputNumber
              step={0.01}
              min={18}
              max={35}
              addonAfter="mm"
              style={{ width: '100%' }}
              placeholder="24.00"
            />
          </Form.Item>
        </Col>

        {/* 角膜曲率 K1 / K2 — only when includeCorneaCurvature */}
        {includeCorneaCurvature && (
          <>
            <Col xs={24} sm={12}>
              <Form.Item
                label="角膜曲率 K1"
                name={[prefix, 'k1']}
              >
                <InputNumber
                  step={0.01}
                  addonAfter="D"
                  style={{ width: '100%' }}
                  placeholder="43.00"
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                label="角膜曲率 K2"
                name={[prefix, 'k2']}
              >
                <InputNumber
                  step={0.01}
                  addonAfter="D"
                  style={{ width: '100%' }}
                  placeholder="44.00"
                />
              </Form.Item>
            </Col>
          </>
        )}
      </Row>
    </div>
  )
}
