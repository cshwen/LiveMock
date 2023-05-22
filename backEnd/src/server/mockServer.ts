import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { Collection } from "lokijs";
import { ExpectationM } from "core/struct/expectation";
import { getExpectationDb } from "../db/dbManager";
import arrayUtils from "../util/arrayUtils";
import { IMatcher } from "core/struct/matcher";
import { getMatcherImpl } from "../matcher/matchUtils";
import { getActionImpl } from "../action/common";
import {getLogCollection, insertReqLog, insertResLog} from "../log/logUtils";
import * as http from "http";
import * as buffer from "buffer";

async function getExpectationCollection(
  projectId: string,
  path: string
): Promise<Collection<ExpectationM>> {
  const db = await getExpectationDb(projectId, path);
  return db.getCollection("expectation");
}
// default is 10mb
const MaxRawBodySize = 10 * 1024 * 1024;

const getMockRouter: (
  path: string,
  projectId: string
) => Promise<express.Router> = async (path, projectId) => {
  let router = express.Router();
  const expectationCollection = await getExpectationCollection(projectId, path);
  const logCollection = await getLogCollection(projectId, path);
    // request raw body
    /*
    router.use((req: Request, res, next) => {
      const bodyChunks:Array<Buffer> = [];
      let bodySize = 0;
      req.on("data", function(chunk) {
          bodySize += chunk.length;
          if (bodySize > MaxRawBodySize) {
          } else {
              bodyChunks.push(chunk);
          }
      });
      req.on("end", function() {
          if(bodySize <= MaxRawBodySize){
              // @ts-ignore
              req.rawBody = Buffer.concat(bodyChunks).toString();
          }
          next();
      });

  });
   */

  router.use(bodyParser({
      verify(req: http.IncomingMessage, res: http.ServerResponse, buf: Buffer, encoding: string) {
          if(buf.length < MaxRawBodySize){
              (req as unknown as {rawBody:string}).rawBody = buf.toString(encoding as BufferEncoding);
          }
      }
  }));
  router.all("*",async (req: Request, res: Response) => {
    const expectations = expectationCollection
      .chain()
      .find({ activate: true })
      .compoundsort([
        ["priority", true],
        ["createTime", false],
      ])
      .data();
    await arrayUtils.first(
      expectations,
      async (expectation, expectationIndex) => {
        let allValid = arrayUtils.validAll(
          expectation.matchers,
          (matcher, matcherIndex) => {
            let matchImpl: IMatcher | null = getMatcherImpl(matcher);
            if (matchImpl) {
              return matchImpl.match(req);
            } else {
              return false;
            }
          }
        );
        if (allValid) {
          if (expectation.actions.length !== 0) {
            const actionImpl = getActionImpl(
              expectation.actions[0],
              expectation.delay
            );
            const logM = insertReqLog(logCollection, req, res, expectation.id);
            await actionImpl?.process(req, res);
            logM && insertResLog(logCollection,req,res,expectation.id,logM);
            return true;
          }
        }
        return false;
      }
    );
  });
  return router;
};

export default getMockRouter;
