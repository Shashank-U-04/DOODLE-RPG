// Any unknown path: a plain 404 on the menu paper, with a way back.
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="dd-landing">
      <div className="dd-screen">
        <div className="panel">
          <h1>404</h1>
          <h2>this page was never drawn</h2>
          <div className="mainbtns">
            <Link to="/">
              <button type="button">BACK TO TITLE</button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
