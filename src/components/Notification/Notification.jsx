import React from 'react';
import PropTypes from 'prop-types';
import {
  Container,
  Text,
  Icon,
  TextRow,
  ButtonsRow,
  ButtonStyled,
} from './style';

const Notification = ({
  text,
  onClose,
  type,
  action,
  secondaryAction,
}) => (
  <Container>
    <TextRow>
      <Text>{text}</Text>
      <Icon onClick={onClose} />
    </TextRow>
    {type === 'action' && (
      <ButtonsRow>
        {action && (
          <ButtonStyled onClick={action.callback} label={action.label} type="text" />
        )}
        {secondaryAction && (
          <ButtonStyled
            onClick={secondaryAction.callback}
            label={secondaryAction.label}
            type="text"
          />
        )}
      </ButtonsRow>
    )}
  </Container>
);

Notification.propTypes = {
  /** Text of the notification */
  text: PropTypes.string.isRequired,

  /** Callback function to execute when the notification closes */
  onClose: PropTypes.func.isRequired,

  /** Type of the notification */
  type: PropTypes.oneOf(['action', 'text']),

  /** The main action settings {**label**: the label of the button,  **disabled** to disable the button, **callback** a callback to invoke on action click, before dismiss */
  action: PropTypes.shape({
    label: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    callback: PropTypes.func,
  }),
  /** The secondary action settings {**label**: the label of the button, **disabled** to disable the button, **callback** a callback to invoke on action click, before dismiss */
  secondaryAction: PropTypes.shape({
    label: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    callback: PropTypes.func,
  }),
};

Notification.defaultProps = {
  type: 'text',
  action: undefined,
  secondaryAction: undefined,
};

export default Notification;
